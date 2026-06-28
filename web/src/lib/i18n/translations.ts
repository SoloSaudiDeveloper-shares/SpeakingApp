/**
 * Translation strings for English and Arabic.
 * Used by useTranslation hook and I18nProvider.
 */

export type Language = "en" | "ar"

export const TRANSLATIONS = {
  // Common
  "common.dashboard": { en: "Dashboard", ar: "لوحة التحكم" },
  "common.practice": { en: "Practice", ar: "ممارسة" },
  "common.text_practice": { en: "Text Practice", ar: "ممارسة النصوص" },
  "common.history": { en: "History", ar: "السجل" },
  "common.review": { en: "Review", ar: "المراجعة" },
  "common.reports": { en: "Reports", ar: "التقارير" },
  "common.students": { en: "Students", ar: "الطلاب" },
  "common.books": { en: "Books", ar: "الكتب" },
  "common.cycles": { en: "Cycles", ar: "الدورات" },
  "common.live_sessions": { en: "Live Sessions", ar: "الجلسات الحية" },
  "common.models": { en: "Models", ar: "النماذج" },
  "common.system": { en: "System", ar: "النظام" },
  "common.settings": { en: "Settings", ar: "الإعدادات" },
  "common.save": { en: "Save", ar: "حفظ" },
  "common.cancel": { en: "Cancel", ar: "إلغاء" },
  "common.delete": { en: "Delete", ar: "حذف" },
  "common.edit": { en: "Edit", ar: "تعديل" },
  "common.start": { en: "Start", ar: "ابدأ" },
  "common.stop": { en: "Stop", ar: "توقف" },
  "common.loading": { en: "Loading...", ar: "جاري التحميل..." },
  "common.username": { en: "Username", ar: "اسم المستخدم" },
  "common.password": { en: "Password", ar: "كلمة المرور" },
  "common.sign_in": { en: "Sign in", ar: "تسجيل الدخول" },
  "common.logout": { en: "Logout", ar: "تسجيل الخروج" },
  "common.change_password": { en: "Change Password", ar: "تغيير كلمة المرور" },

  // Auth
  "auth.welcome_back": { en: "Welcome back", ar: "مرحبًا بعودتك" },
  "auth.sign_in_to_continue": { en: "Sign in to continue", ar: "سجّل الدخول للمتابعة" },
  "auth.create_account": { en: "Create Account", ar: "إنشاء حساب" },
  "auth.register_as_student": { en: "Register as Student", ar: "التسجيل كطالب" },
  "auth.new_student": { en: "New student?", ar: "طالب جديد؟" },
  "auth.invalid_credentials": { en: "Invalid username or password.", ar: "اسم المستخدم أو كلمة المرور غير صحيحة." },

  // Practice
  "practice.start_speaking": { en: "Start speaking", ar: "ابدأ التحدث" },
  "practice.stop_recording": { en: "Stop recording", ar: "إيقاف التسجيل" },
  "practice.target_word": { en: "Target word", ar: "الكلمة المستهدفة" },
  "practice.your_response": { en: "Your response", ar: "إجابتك" },
  "practice.score": { en: "Score", ar: "الدرجة" },
  "practice.no_speech_detected": { en: "No speech detected", ar: "لم يُكتشف أي كلام" },
  "practice.long_pause_warning": { en: "Long pause detected — keep speaking!", ar: "تم اكتشاف توقف طويل — استمر في التحدث!" },
  "practice.next_word": { en: "Next word", ar: "الكلمة التالية" },

  // Settings
  "settings.theme": { en: "Theme", ar: "المظهر" },
  "settings.language": { en: "Language", ar: "اللغة" },
  "settings.light": { en: "Light", ar: "فاتح" },
  "settings.dark": { en: "Dark", ar: "داكن" },
  "settings.accent_color": { en: "Accent color", ar: "اللون المميز" },
  "settings.pause_warning_seconds": { en: "Pause warning timeout (seconds)", ar: "مهلة تحذير التوقف (ثوانٍ)" },

  // Roles
  "role.student": { en: "Student", ar: "طالب" },
  "role.teacher": { en: "Teacher", ar: "معلم" },
  "role.admin": { en: "Admin", ar: "مسؤول" },

  // Impersonation
  "impersonation.viewing_as": { en: "Viewing as", ar: "العرض كـ" },
  "impersonation.back_to_admin": { en: "Back to Admin", ar: "العودة للمسؤول" },
  "impersonation.switch_to_learner": { en: "Switch to Learner", ar: "التحويل إلى متعلم" },

  // AI Conversation
  "ai_conv.title": { en: "AI Conversation", ar: "محادثة الذكاء الاصطناعي" },
  "ai_conv.start_conversation": { en: "Start a conversation", ar: "ابدأ محادثة" },
  "ai_conv.placeholder": { en: "Type or speak your message...", ar: "اكتب أو تحدث برسالتك..." },
  "ai_conv.thinking": { en: "AI is thinking...", ar: "الذكاء الاصطناعي يفكر..." },

  // Class Monitor
  "monitor.class_monitor": { en: "Class Monitor", ar: "مراقب الصف" },
  "monitor.live_now": { en: "Live now", ar: "نشط الآن" },
  "monitor.no_active_students": { en: "No students currently practicing", ar: "لا يوجد طلاب يمارسون حاليًا" },
  "monitor.last_active": { en: "Last active", ar: "آخر نشاط" },
} as const

export type TranslationKey = keyof typeof TRANSLATIONS

export function translate(key: TranslationKey, lang: Language): string {
  const entry = TRANSLATIONS[key]
  if (!entry) return key
  return entry[lang] ?? entry.en ?? key
}
