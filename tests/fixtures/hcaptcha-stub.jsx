import React, { forwardRef, useImperativeHandle } from 'react'
export default forwardRef(function Captcha({ onVerify, onExpire }, ref) {
  useImperativeHandle(ref, () => ({ resetCaptcha() { globalThis.__captchaResets = (globalThis.__captchaResets || 0) + 1 } }))
  return <div><button type="button" onClick={() => onVerify('test-captcha-token')}>Пройти тест капчи</button><button type="button" onClick={onExpire}>Истечь капче</button></div>
})
