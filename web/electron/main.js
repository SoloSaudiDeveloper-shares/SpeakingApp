// Electron main process for Speaking Lab.
//
// Responsibilities at startup:
//   1. Find a free port (default 3939)
//   2. Spawn the bundled Next.js standalone server on that port
//   3. Wait for it to be ready
//   4. Open a BrowserWindow pointing at http://localhost:<port>
//
// In production the standalone server lives under:
//   resources/app.asar.unpacked/.next/standalone/server.js
//
// In dev (`npm run electron:dev`) we point at the running `next dev` server.

const { app, BrowserWindow, shell, Menu, dialog, session } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const http = require('http')
const net = require('net')

let mainWindow = null
let serverProcess = null
let serverPort = 3939
let serverReady = false

const isDev = !app.isPackaged
const APP_NAME = 'Speaking Lab'

// ── File-based logging so we can debug packaged startup failures ──────
// Log to TWO places so we can find at least one even if userData fails.
const tmpLogPath = path.join(require('os').tmpdir(), 'speaking-lab-main.log')
let logPath = tmpLogPath
try {
  fs.writeFileSync(tmpLogPath, '') // truncate
} catch { /* ignore */ }
function flog(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}\n`
  try { fs.appendFileSync(logPath, line) } catch { /* ignore */ }
  console.log(...args)
}
flog('=== Speaking Lab boot ===')
flog('isDev=', isDev, 'execPath=', process.execPath, 'resourcesPath=', process.resourcesPath)

// Move log to userData once Electron is ready (better location)
app.whenReady().then(() => {
  try {
    const userDir = app.getPath('userData')
    fs.mkdirSync(userDir, { recursive: true })
    logPath = path.join(userDir, 'main.log')
    flog('Switched log to', logPath)
  } catch (e) {
    flog('Could not move log to userData:', String(e))
  }
}).catch(() => {})

// Catch all unhandled errors
process.on('uncaughtException', (err) => flog('UNCAUGHT:', err && err.stack ? err.stack : String(err)))
process.on('unhandledRejection', (err) => flog('UNHANDLED:', String(err)))

/* ──────────────────────────────────────────────────────────────────── */
/* Server lifecycle                                                     */
/* ──────────────────────────────────────────────────────────────────── */

function findFreePort(startPort = 3939) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const tester = net.createServer()
      tester.once('error', () => {
        if (port > startPort + 50) reject(new Error('No free port found'))
        else tryPort(port + 1)
      })
      tester.once('listening', () => {
        tester.close(() => resolve(port))
      })
      tester.listen(port, '127.0.0.1')
    }
    tryPort(startPort)
  })
}

function waitForServer(port, timeoutMs = 30000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      http
        .get({ host: '127.0.0.1', port, path: '/', timeout: 1000 }, (res) => {
          if (res.statusCode && res.statusCode < 500) {
            serverReady = true
            resolve()
          } else {
            retry()
          }
          res.resume()
        })
        .on('error', retry)
        .on('timeout', retry)
    }
    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error('Server failed to start within ' + timeoutMs + 'ms'))
      } else {
        setTimeout(check, 300)
      }
    }
    check()
  })
}

async function startNextServer() {
  serverPort = await findFreePort(3939)
  flog(`Starting Next.js server on port ${serverPort}`)

  if (isDev) {
    // In dev, assume `next dev` is already running on 3000
    serverPort = 3000
    return
  }

  // In production, run the bundled standalone server.
  // We use { asar: false } + extraResources so the standalone tree sits at
  // resources/app/.next/standalone (no asar unpacking needed, no symlinks).
  const standaloneDir = path.join(
    process.resourcesPath,
    'app',
    '.next',
    'standalone',
  )
  const serverEntry = path.join(standaloneDir, 'server.js')

  if (!fs.existsSync(serverEntry)) {
    throw new Error('Bundled server not found at ' + serverEntry)
  }

  // Mount the data directory in the user's appData so it persists across upgrades.
  const userDataDir = app.getPath('userData')
  const dataDir = path.join(userDataDir, 'data')
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: standaloneDir,
    env: {
      ...process.env,
      // Tell Node it's being launched by Electron's bundled Node
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(serverPort),
      HOSTNAME: '127.0.0.1',
      // Point the app's database path at the user data dir
      SPEAKING_LAB_DATA_DIR: dataDir,
      // Packaged demo builds should always keep the documented demo logins usable.
      SPEAKING_LAB_RESET_DEMO_LOGINS: '1',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  serverProcess.stdout.on('data', (d) => flog('[server]', d.toString().trim()))
  serverProcess.stderr.on('data', (d) => flog('[server-err]', d.toString().trim()))
  serverProcess.on('exit', (code) => {
    flog('Server process exited with code', code)
    if (!app.isQuitting) {
      app.quit()
    }
  })

  await waitForServer(serverPort)
  flog('Server is ready')
}

async function clearStartupAuthCookies() {
  const authCookieNames = new Set(['session-token', 'view-as'])
  try {
    const allCookies = await session.defaultSession.cookies.get({})
    const authCookies = allCookies.filter((cookie) => authCookieNames.has(cookie.name))
    for (const cookie of authCookies) {
      const domain = (cookie.domain || '127.0.0.1').replace(/^\./, '')
      const pathPart = cookie.path || '/'
      const url = `${cookie.secure ? 'https' : 'http'}://${domain}${pathPart}`
      try {
        await session.defaultSession.cookies.remove(url, cookie.name)
        flog('Cleared startup auth cookie:', cookie.name, domain)
      } catch (e) {
        flog('Could not clear startup auth cookie:', cookie.name, domain, String(e))
      }
    }
  } catch (e) {
    flog('Could not inspect startup auth cookies:', String(e))
  }
}

function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    try {
      serverProcess.kill()
    } catch (e) {
      flog('Error killing server:', String(e))
    }
  }
}

/* ──────────────────────────────────────────────────────────────────── */
/* Window                                                               */
/* ──────────────────────────────────────────────────────────────────── */

function createMainWindow() {
  flog('Creating main window')
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: APP_NAME,
    backgroundColor: '#0b0d12',
    show: true, // Show immediately — don't wait for ready-to-show
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Sandbox can block media permissions on Windows
      webSecurity: true,
    },
  })
  flog('Main window created')

  mainWindow.once('ready-to-show', () => {
    flog('ready-to-show fired')
    mainWindow.show()
    mainWindow.focus()
  })

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    flog('did-fail-load:', code, desc, url)
  })
  mainWindow.webContents.on('did-finish-load', () => flog('did-finish-load'))
  mainWindow.webContents.on('render-process-gone', (_e, details) => flog('renderer gone:', JSON.stringify(details)))

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) {
      return { action: 'allow' }
    }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const targetUrl = `http://127.0.0.1:${serverPort}/`
  flog('Loading URL:', targetUrl)
  mainWindow.loadURL(targetUrl)

  mainWindow.on('closed', () => {
    flog('Main window closed')
    mainWindow = null
  })
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About ' + APP_NAME,
          click: () =>
            dialog.showMessageBox(mainWindow, {
              title: 'About ' + APP_NAME,
              message: APP_NAME,
              detail: 'Offline English speaking practice platform.\n\nVersion: ' + app.getVersion(),
              buttons: ['OK'],
            }),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/* ──────────────────────────────────────────────────────────────────── */
/* App lifecycle                                                        */
/* ──────────────────────────────────────────────────────────────────── */

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    buildMenu()
    try {
      await startNextServer()
      await clearStartupAuthCookies()
      createMainWindow()
    } catch (err) {
      flog('Failed to start:', err && err.stack ? err.stack : String(err))
      dialog.showErrorBox(
        APP_NAME + ' — Failed to Start',
        'The application could not start its internal server.\n\n' +
          (err && err.message ? err.message : String(err)),
      )
      app.quit()
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    app.isQuitting = true
    stopServer()
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    app.isQuitting = true
    stopServer()
  })
}
