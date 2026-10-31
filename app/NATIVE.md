# Мобильное приложение NAME (Android сейчас, iOS потом)

Тот же React-код, что и на сайте, живёт внутри нативной оболочки
[Capacitor 8](https://capacitorjs.com). Отдельного «мобильного» интерфейса нет:
собирается `app/dist`, кладётся в WebView, а нативные плагины дают статус-бар,
сплэш, кнопку «назад», системный браузер для OAuth и запуск MLBB.

| Что | Значение |
| --- | --- |
| appId / bundle id | `com.namemlbb.app` |
| Имя приложения | NAME |
| Deep link возврата | `com.namemlbb.app://auth` |
| Иконки и сплэш | `app/resources/icon.png` (1024×1024), `app/resources/splash.png`, генератор — `npm run icons` |
| Фон | `#08080b` |

## Что уже сделано в коде

- `app/capacitor.config.ts` — конфиг оболочки, тёмный статус-бар и сплэш.
- `app/vite.config.js` — при `VITE_NATIVE=1` ассеты собираются по относительным
  путям (`./assets/…`). Без этого WebView показывает белый экран.
- `app/src/native.js` — статус-бар, сплэш, аппаратная кнопка «назад»,
  внешние ссылки в системном браузере, приём deep link, запуск MLBB.
- `app/src/native-auth.js` — вход через Google/Telegram: ссылка открывается в
  системном браузере (`skipBrowserRedirect`), возврат ловится по
  `com.namemlbb.app://auth` и меняется на сессию Supabase.
- `app/android` — проект Android с intent-filter на `com.namemlbb.app://auth`.
- `app/ios` — проект iOS с `CFBundleURLSchemes` (собирать на Mac, когда дойдём).
- `.github/workflows/android.yml` — сборка APK на каждый пуш и AAB для Play,
  если добавлен ключ подписи.

## Supabase (уже настроено)

В проекте `yjedqdbwvjvikyixsduw` → **Authentication → URL Configuration →
Redirect URLs** добавлены:

```
com.namemlbb.app://auth
com.namemlbb.app://**
```

Если переносишь проект в другой Supabase — добавь эти две строки заново, иначе
провайдер вернёт `redirect_uri not allowed` и вход в приложении не завершится.

## Сборка APK (без своего компьютера)

1. Открой вкладку **Actions** → **Android APK** → **Run workflow**.
2. Через ~5 минут открой **Releases** → **Android APK**.
3. Скачай `NAME-<номер>.apk` на телефон и разреши установку из этого источника.

Ссылка на релиз постоянная, файл в нём всегда последний:
`https://github.com/OTSHELNIKS/Exams/releases/tag/android-latest`

APK подписан отладочным ключом — для установки с телефона этого достаточно,
но Google Play такой файл не примет (см. ниже).

## Сборка на своём компьютере

Нужны Node 22 и JDK 21 (Android Studio ставит его сам).

```bash
cd app
npm ci
npm run sync:android     # сборка веба + npx cap sync android
npx cap open android     # откроется Android Studio → Run
```

`npm run dev` для приложения не работает: нужен собранный `dist` и `cap sync`
после каждой правки веба.

## Google Play: ключ подписи

Play требует подписанный AAB и **свой** ключ. Ключ создаётся один раз:

```bash
keytool -genkey -v -keystore upload.jks -keyalg RSA -keysize 2048 \
  -validity 10000 -alias upload
```

Дальше в GitHub → **Settings → Secrets and variables → Actions** добавь:

| Секрет | Что это |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 upload.jks` (на macOS: `base64 -i upload.jks`) |
| `ANDROID_KEYSTORE_PASSWORD` | пароль хранилища |
| `ANDROID_KEY_ALIAS` | `upload` |
| `ANDROID_KEY_PASSWORD` | пароль ключа |

После этого workflow начнёт собирать ещё и `NAME-<номер>.aab` — его
загружают в Play Console → **Testing → Internal testing** → **Create release**.

> Сохрани `upload.jks` и пароли в надёжном месте. Потеряешь ключ — не сможешь
> обновлять приложение в Play (придётся публиковать новый пакет).

## Публикация в Google Play: чек-лист

1. Аккаунт разработчика — 25 $ один раз: <https://play.google.com/console/signup>.
2. Создать приложение: имя **NAME**, язык по умолчанию — русский, тип
   «Приложение», бесплатное.
3. **App content** (обязательные формы):
   - Privacy policy: `https://otshelniks.github.io/Exams/privacy.html`
   - Data safety: какие данные собираем — см. `app/STORE.md`.
   - Content rating: пройти опрос (насилие/азартные игры — нет).
   - Target audience: 13+ (не «для детей»).
   - Ads: «Нет рекламы».
4. **Store listing**: тексты и графика — `app/STORE.md`.
5. **Testing → Internal testing**: загрузить `.aab`, добавить себя в тестировщики,
   установить по ссылке, проверить вход, привязку Google и «Открыть игру».
6. **Production → Create release** → отправить на проверку (обычно 1–7 дней).

## iOS (позже)

Код уже готов: `app/ios` содержит проект с той же схемой возврата. Понадобится
Mac с Xcode и Apple Developer Program (99 $/год).

```bash
cd app && npm ci && npm run sync:ios
npx cap open ios      # Xcode → Signing & Capabilities → выбрать свою команду
```

- Bundle id `com.namemlbb.app` (можно поменять в Xcode до первой публикации).
- В App Store Connect создать приложение с тем же bundle id.
- Privacy policy — тот же URL; App Privacy — те же ответы, что Data safety в Play.
- Проверка ревью Apple: вход по email/коду работает без внешних сервисов,
  аккаунт для ревьюера не требуется (регистрация внутри приложения).

## Как проверить deep link

Android, телефон подключён по USB с включённой отладкой:

```bash
adb shell am start -a android.intent.action.VIEW \
  -d "com.namemlbb.app://auth?code=test" com.namemlbb.app
```

Приложение должно открыться и показать ошибку обмена кода (код тестовый) —
значит intent-filter и обработчик на месте.

## Частые проблемы

| Симптом | Причина |
| --- | --- |
| Белый экран после запуска | собрано без `VITE_NATIVE=1` (абсолютные `/assets/…`) |
| Google пишет «disallowed_useragent» | OAuth открыли внутри WebView, а не через `Browser.open` |
| После входа остаёмся в браузере | `com.namemlbb.app://auth` не добавлен в Supabase Redirect URLs |
| «Открыть игру» ничего не делает | MLBB не установлен — уводим в Play Store, это ожидаемо |
| APK не ставится | на телефоне не разрешена установка из этого источника |
