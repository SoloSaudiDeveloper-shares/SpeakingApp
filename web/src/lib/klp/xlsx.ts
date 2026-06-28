import { inflateRawSync } from 'zlib';

export type KlpSupportStatus = 'speaking_scored' | 'prompt_context_only' | 'unsupported';
export type KlpDomain = 'Vocabulary' | 'Grammar' | 'Functions' | 'Skills';

export interface ParsedKlpConcept {
  conceptId: string;
  book: string;
  lesson: string;
  domain: KlpDomain;
  conceptNumber: string;
  subdivision: string;
  baseItem: string;
  subtype: string;
  partOfSpeech: string;
  definition: string;
  dliClassification: string;
  primarySkillType: string;
  secondarySkillType: string;
  tertiarySkillType: string;
  quaternarySkillType: string;
  duplicateInCourse: string;
  duplicateInBook: string;
  supportStatus: KlpSupportStatus;
  activeQuestionCount: number;
  activeQuestionShapes: string[];
  raw: Record<string, string>;
}

export interface ParsedKlpQuestionShape {
  questionId: string;
  conceptId: string;
  questionShape: string;
  modality: string;
  raw: Record<string, string>;
}

export interface ParsedKlpWorkbook {
  concepts: ParsedKlpConcept[];
  activeQuestionShapes: ParsedKlpQuestionShape[];
  warnings: string[];
  summary: {
    conceptsTotal: number;
    activeQuestionShapesTotal: number;
    byDomain: Record<string, number>;
    bySupportStatus: Record<string, number>;
    unmatchedActiveQuestionIds: string[];
  };
}

type SheetRows = string[][];

function readUInt16(buffer: Buffer, offset: number) {
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer: Buffer, offset: number) {
  return buffer.readUInt32LE(offset);
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripTags(value: string) {
  return decodeXml(value.replace(/<[^>]+>/g, '')).trim();
}

function xmlAttr(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name.replace(':', ':')}="([^"]*)"`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function unzipEntries(input: Buffer): Map<string, string> {
  let eocd = -1;
  for (let i = input.length - 22; i >= 0; i -= 1) {
    if (readUInt32(input, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Invalid XLSX archive: end record was not found.');

  const totalEntries = readUInt16(input, eocd + 10);
  const centralOffset = readUInt32(input, eocd + 16);
  const files = new Map<string, string>();
  let offset = centralOffset;

  for (let i = 0; i < totalEntries; i += 1) {
    if (readUInt32(input, offset) !== 0x02014b50) throw new Error('Invalid XLSX archive: central directory is corrupt.');
    const method = readUInt16(input, offset + 10);
    const compressedSize = readUInt32(input, offset + 20);
    const fileNameLength = readUInt16(input, offset + 28);
    const extraLength = readUInt16(input, offset + 30);
    const commentLength = readUInt16(input, offset + 32);
    const localOffset = readUInt32(input, offset + 42);
    const name = input.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8');

    if (readUInt32(input, localOffset) !== 0x04034b50) throw new Error(`Invalid XLSX archive: local header missing for ${name}.`);
    const localNameLength = readUInt16(input, localOffset + 26);
    const localExtraLength = readUInt16(input, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = input.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (method === 0) data = compressed;
    else if (method === 8) data = inflateRawSync(compressed);
    else throw new Error(`Unsupported XLSX compression method ${method} in ${name}.`);
    files.set(name.replace(/\\/g, '/'), data.toString('utf8'));

    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return files;
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  for (const match of xml.matchAll(/<si\b[\s\S]*?<\/si>/g)) {
    const si = match[0];
    const parts = Array.from(si.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)).map((m) => decodeXml(m[1]));
    out.push(parts.length ? parts.join('') : stripTags(si));
  }
  return out;
}

function columnIndex(cellRef: string, fallback: number) {
  const letters = (cellRef.match(/[A-Z]+/i)?.[0] ?? '').toUpperCase();
  if (!letters) return fallback;
  let value = 0;
  for (const ch of letters) value = value * 26 + (ch.charCodeAt(0) - 64);
  return value - 1;
}

function parseSheetRows(xml: string, sharedStrings: string[]): SheetRows {
  const rows: SheetRows = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowXml = rowMatch[1];
    const row: string[] = [];
    let fallbackIndex = 0;
    for (const cellMatch of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const cellXml = cellMatch[2];
      const index = columnIndex(xmlAttr(attrs, 'r'), fallbackIndex);
      const type = xmlAttr(attrs, 't');
      const valueMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
      let value = '';
      if (type === 's') {
        const sharedIndex = Number(valueMatch?.[1] ?? -1);
        value = Number.isFinite(sharedIndex) ? sharedStrings[sharedIndex] ?? '' : '';
      } else if (type === 'inlineStr') {
        value = Array.from(cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)).map((m) => decodeXml(m[1])).join('');
      } else if (valueMatch) {
        value = decodeXml(valueMatch[1]);
      } else {
        value = stripTags(cellXml);
      }
      row[index] = value.trim();
      fallbackIndex = index + 1;
    }
    rows.push(row.map((cell) => cell ?? ''));
  }
  return rows;
}

function workbookSheets(entries: Map<string, string>) {
  const workbook = entries.get('xl/workbook.xml');
  const rels = entries.get('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) throw new Error('Invalid XLSX workbook: workbook metadata is missing.');

  const relMap = new Map<string, string>();
  for (const rel of rels.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    relMap.set(xmlAttr(rel[1], 'Id'), xmlAttr(rel[1], 'Target').replace(/^\//, ''));
  }

  const sheets: Array<{ name: string; path: string }> = [];
  for (const sheet of workbook.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const attrs = sheet[1];
    const relId = xmlAttr(attrs, 'r:id');
    const target = relMap.get(relId);
    if (!target) continue;
    sheets.push({
      name: xmlAttr(attrs, 'name'),
      path: target.startsWith('xl/') ? target : `xl/${target}`,
    });
  }
  return sheets;
}

export function readXlsxSheets(buffer: Buffer): Record<string, SheetRows> {
  const entries = unzipEntries(buffer);
  const sharedStrings = parseSharedStrings(entries.get('xl/sharedStrings.xml'));
  const out: Record<string, SheetRows> = {};
  for (const sheet of workbookSheets(entries)) {
    const xml = entries.get(sheet.path);
    if (xml) out[sheet.name] = parseSheetRows(xml, sharedStrings);
  }
  return out;
}

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function rowObjects(rows: SheetRows): Record<string, string>[] {
  const [header, ...body] = rows;
  const headers = (header ?? []).map(normalize);
  return body
    .map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        if (h) obj[h] = normalize(row[i]);
      });
      return obj;
    })
    .filter((row) => Object.values(row).some(Boolean));
}

function supportStatus(domain: KlpDomain, row: Record<string, string>): KlpSupportStatus {
  if (domain === 'Grammar' || domain === 'Functions') return 'prompt_context_only';
  if (domain === 'Vocabulary') return 'speaking_scored';
  const skillText = [
    row['Primary Skill Type'],
    row['Secondary Skill Type'],
    row['Tertiary Skill Type'],
    row['Quaternary Skill Type'],
    row['Base Skill Item'],
    row['Skill Subtype'],
  ].join(' ').toLowerCase();
  if (skillText.includes('speaking') || skillText.includes('listening') || skillText.includes('mimic')) {
    return 'speaking_scored';
  }
  return 'unsupported';
}

function conceptFromRow(domain: KlpDomain, row: Record<string, string>): ParsedKlpConcept | null {
  const conceptId = normalize(row.ConceptID);
  if (!conceptId) return null;
  const prefix = domain === 'Vocabulary' ? 'Vocabulary' : domain === 'Grammar' ? 'Grammar' : domain === 'Functions' ? 'Function' : 'Skill';
  return {
    conceptId,
    book: normalize(row.Book),
    lesson: normalize(row.Lesson),
    domain,
    conceptNumber: normalize(row['Concept Number']),
    subdivision: normalize(row.Subdivision),
    baseItem: normalize(row[`Base ${prefix} Item`]),
    subtype: normalize(row[`${prefix} Subtype`]),
    partOfSpeech: normalize(row['Part of Speech']),
    definition: normalize(row.Definition),
    dliClassification: normalize(row['DLI Classification']),
    primarySkillType: normalize(row['Primary Skill Type']),
    secondarySkillType: normalize(row['Secondary Skill Type']),
    tertiarySkillType: normalize(row['Tertiary Skill Type']),
    quaternarySkillType: normalize(row['Quaternary Skill Type']),
    duplicateInCourse: normalize(row['Duplicate in Course']),
    duplicateInBook: normalize(row['Duplicate in Book']),
    supportStatus: supportStatus(domain, row),
    activeQuestionCount: 0,
    activeQuestionShapes: [],
    raw: row,
  };
}

function conceptIdFromQuestionId(questionId: string) {
  const parts = questionId.split('-');
  return parts.length >= 5 ? parts.slice(0, 5).join('-') : questionId;
}

function modalityFromQuestionId(questionId: string) {
  return questionId.split('-')[5] ?? '';
}

export function parseAlcKlpWorkbook(buffer: Buffer): ParsedKlpWorkbook {
  const sheets = readXlsxSheets(buffer);
  const warnings: string[] = [];
  const domains: Array<[KlpDomain, string]> = [
    ['Vocabulary', 'Vocabulary'],
    ['Grammar', 'Grammar'],
    ['Functions', 'Functions'],
    ['Skills', 'Skills'],
  ];
  const concepts: ParsedKlpConcept[] = [];

  for (const [domain, sheetName] of domains) {
    const rows = sheets[sheetName];
    if (!rows) {
      warnings.push(`Missing sheet: ${sheetName}`);
      continue;
    }
    for (const row of rowObjects(rows)) {
      const concept = conceptFromRow(domain, row);
      if (concept) concepts.push(concept);
    }
  }

  const conceptMap = new Map(concepts.map((concept) => [concept.conceptId, concept]));
  const activeQuestionShapes: ParsedKlpQuestionShape[] = [];
  const unmatched: string[] = [];
  const questionRows = sheets.active_question_shapes ? rowObjects(sheets.active_question_shapes) : [];
  if (!sheets.active_question_shapes) warnings.push('Missing sheet: active_question_shapes');

  for (const row of questionRows) {
    const questionId = normalize(row.question_id);
    const questionShape = normalize(row.question_shape);
    if (!questionId || !questionShape) continue;
    const conceptId = conceptIdFromQuestionId(questionId);
    const modality = modalityFromQuestionId(questionId);
    activeQuestionShapes.push({ questionId, conceptId, questionShape, modality, raw: row });
    const concept = conceptMap.get(conceptId);
    if (!concept) {
      unmatched.push(questionId);
      continue;
    }
    concept.activeQuestionCount += 1;
    if (!concept.activeQuestionShapes.includes(questionShape)) concept.activeQuestionShapes.push(questionShape);
  }

  const seen = new Set<string>();
  for (const concept of concepts) {
    if (seen.has(concept.conceptId)) warnings.push(`Duplicate ConceptID in workbook: ${concept.conceptId}`);
    seen.add(concept.conceptId);
  }
  if (unmatched.length > 0) warnings.push(`${unmatched.length} active question IDs did not match an imported ConceptID.`);

  const byDomain: Record<string, number> = {};
  const bySupportStatus: Record<string, number> = {};
  for (const concept of concepts) {
    byDomain[concept.domain] = (byDomain[concept.domain] ?? 0) + 1;
    bySupportStatus[concept.supportStatus] = (bySupportStatus[concept.supportStatus] ?? 0) + 1;
  }

  return {
    concepts,
    activeQuestionShapes,
    warnings,
    summary: {
      conceptsTotal: concepts.length,
      activeQuestionShapesTotal: activeQuestionShapes.length,
      byDomain,
      bySupportStatus,
      unmatchedActiveQuestionIds: unmatched,
    },
  };
}
