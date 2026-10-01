/* eslint-disable @typescript-eslint/ban-ts-comment */
import {
  Tray, nativeImage, Menu, BrowserWindow, ipcMain, screen, MenuItemConstructorOptions, app,
} from 'electron';
import { createInstance } from 'i18next';
import tr from '../renderer/src/locales/tr-TR/translation.json';
import en from '../renderer/src/locales/en/translation.json';
// @ts-expect-error
import trayIcon from '../../resources/icon.png?asset';

export interface ConfigFile {
  filename: string;
  name: string;
}

export class MenuManager {
  private i18n = createInstance();

  private tray: Tray | null = null;

  private currentMode: 'window' | 'pet' = 'window';

  private configFiles: ConfigFile[] = [];

  constructor(private onModeChange: (mode: 'window' | 'pet') => void) {
    this.i18n.init({ lng: 'tr-TR', fallbackLng: 'tr-TR', resources: { 'tr-TR': { translation: tr }, en: { translation: en } }, initImmediate: false });
    ipcMain.on('tr:language', (_event, lng) => {
      this.i18n.changeLanguage(lng === 'en' ? 'en' : 'tr-TR');
      this.updateTrayMenu();
    });
    this.setupContextMenu();
  }

  createTray(): void {
    const icon = nativeImage.createFromPath(trayIcon);
    const trayIconResized = icon.resize({
      width: process.platform === 'win32' ? 16 : 18,
      height: process.platform === 'win32' ? 16 : 18,
    });

    this.tray = new Tray(trayIconResized);
    this.updateTrayMenu();
  }

  private getModeMenuItems(): MenuItemConstructorOptions[] {
    // console.log('Getting mode menu items, current mode:', this.currentMode)
    return [
      {
        label: this.i18n.t('desktopMenu.window'),
        type: 'radio' as const,
        checked: this.currentMode === 'window',
        click: () => {
          this.setMode('window');
        },
      },
      {
        label: this.i18n.t('desktopMenu.pet'),
        type: 'radio' as const,
        checked: this.currentMode === 'pet',
        click: () => {
          this.setMode('pet');
        },
      },
    ];
  }

  private updateTrayMenu(): void {
    if (!this.tray) return;
    // console.log('Updating tray menu, current mode:', this.currentMode)

    const contextMenu = Menu.buildFromTemplate([
      ...this.getModeMenuItems(),
      { type: 'separator' as const },
      // Only show toggle mouse ignore in pet mode
      ...(this.currentMode === 'pet'
        ? [
          {
            label: this.i18n.t('desktopMenu.passthrough'),
            click: () => {
              const windows = BrowserWindow.getAllWindows();
              windows.forEach((window) => {
                window.webContents.send('toggle-force-ignore-mouse');
              });
            },
          },
          { type: 'separator' as const },
        ]
        : []),
      {
        label: this.i18n.t('desktopMenu.show'),
        click: () => {
          const windows = BrowserWindow.getAllWindows();
          windows.forEach((window) => {
            window.show();
          });
        },
      },
      {
        label: this.i18n.t('desktopMenu.hide'),
        click: () => {
          const windows = BrowserWindow.getAllWindows();
          windows.forEach((window) => {
            window.hide();
          });
        },
      },
      {
        label: this.i18n.t('desktopMenu.exit'),
        click: () => {
          app.quit();
        },
      },
    ]);

    this.tray.setToolTip('Open-LLM-VTuber TR');
    this.tray.setContextMenu(contextMenu);
  }

  private getContextMenuItems(event: Electron.IpcMainEvent): MenuItemConstructorOptions[] {
    const template: MenuItemConstructorOptions[] = [
      {
        label: this.i18n.t('desktopMenu.mic'),
        click: () => {
          event.sender.send('mic-toggle');
        },
      },
      {
        label: this.i18n.t('desktopMenu.interrupt'),
        click: () => {
          event.sender.send('interrupt');
        },
      },
      { type: 'separator' as const },
      // Only show in pet mode
      ...(this.currentMode === 'pet'
        ? [
          {
            label: this.i18n.t('desktopMenu.passthrough'),
            click: () => {
              event.sender.send('toggle-force-ignore-mouse');
            },
          },
        ]
        : []),
      {
        label: this.i18n.t('desktopMenu.resize'),
        click: () => {
          event.sender.send('toggle-scroll-to-resize');
        },
      },
      // Only show this item in pet mode
      ...(this.currentMode === 'pet'
        ? [
          {
            label: this.i18n.t('desktopMenu.subtitle'),
            click: () => {
              event.sender.send('toggle-input-subtitle');
            },
          },
        ]
        : []),
      { type: 'separator' as const },
      ...this.getModeMenuItems(),
      { type: 'separator' as const },
      {
        label: this.i18n.t('desktopMenu.character'),
        visible: this.currentMode === 'pet',
        submenu: this.configFiles.map((config) => ({
          label: config.name,
          click: () => {
            event.sender.send('switch-character', config.filename);
          },
        })),
      },
      { type: 'separator' as const },
      {
        label: this.i18n.t('desktopMenu.hide'),
        click: () => {
          const windows = BrowserWindow.getAllWindows();
          windows.forEach((window) => {
            window.hide();
          });
        },
      },
      {
        label: this.i18n.t('desktopMenu.exit'),
        click: () => {
          app.quit();
        },
      },
    ];
    return template;
  }

  private setupContextMenu(): void {
    ipcMain.on('show-context-menu', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) {
        const screenPoint = screen.getCursorScreenPoint();
        const menu = Menu.buildFromTemplate(this.getContextMenuItems(event));
        menu.popup({
          window: win,
          x: Math.round(screenPoint.x),
          y: Math.round(screenPoint.y),
        });
      }
    });
  }

  setMode(mode: 'window' | 'pet'): void {
    // console.log('Setting mode from', this.currentMode, 'to', mode)
    this.currentMode = mode;
    this.updateTrayMenu();
    this.onModeChange(mode);
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  updateConfigFiles(files: ConfigFile[]): void {
    this.configFiles = files;
  }
}
