import type { CapacitorConfig } from '@capacitor/cli'

// NAME MLBB — мобильное приложение (Capacitor).
//
// Тот же React-код, что и сайт, живёт внутри нативной оболочки: Android — WebView
// в нашем APK/AAB, iOS — WKWebView. Это позволяет собирать стор-версии из одного
// репозитория и не переписывать вход, профиль, драфт и рейтинг заново.
//
// appId — это идентификатор приложения в Google Play и App Store. Он попадает в
// package/bundle id, поэтому поменять его можно только до первой публикации.
const config: CapacitorConfig = {
  appId: 'com.namemlbb.app',
  appName: 'NAME',
  webDir: 'dist',
  // Сайт с GitHub Pages открывается в системном браузере, в приложении — только
  // локальная сборка. Пустой server.url означает «грузим bundled dist».
  android: {
    allowMixedContent: false,
    backgroundColor: '#08080b',
  },
  ios: {
    contentInset: 'always',
    backgroundColor: '#08080b',
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    SplashScreen: {
      backgroundColor: '#08080b',
      showSpinner: false,
      launchShowDuration: 700,
      launchAutoHide: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#08080b',
      overlaysWebView: false,
    },
  },
}

export default config
