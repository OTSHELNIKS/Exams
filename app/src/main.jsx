import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import '@fontsource/unbounded/700.css'
import '@fontsource/unbounded/900.css'
import './styles.css'
import App from './App.jsx'
import { initNative } from './native.js'

// В мобильном приложении (Capacitor) включаем системный статус-бар, кнопку
// «назад» и открытие внешних ссылок в браузере. В вебе функция сразу выходит.
initNative()

createRoot(document.getElementById('root')).render(<App />)
