
const { app, BrowserWindow, session, Menu } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: "Architect Pro - AI PDF Workspace",
    backgroundColor: '#f8fafc',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true
    },
    show: false // Don't show the window until it's ready, prevents white flash
  });

  // Custom Application Menu for native experience
  const template = [
    {
      label: 'File',
      submenu: [
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
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
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Gemini Documentation',
          click: async () => {
            const { shell } = require('electron');
            await shell.openExternal('https://ai.google.dev/gemini-api/docs');
          }
        },
        { type: 'separator' },
        {
          label: 'About Architect Pro',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox({
              title: 'Architect Pro',
              message: 'Visual AI PDF Workspace v2.0.0',
              detail: 'Powered by Google Gemini 3 Flash & pdf-lib.',
              buttons: ['OK'],
              type: 'info'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  win.loadFile('index.html');

  // Prevent white flash by showing only when DOM is rendered
  win.once('ready-to-show', () => {
    win.show();
  });

  // Handle permission requests (Camera for AI vision features)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'camera'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
