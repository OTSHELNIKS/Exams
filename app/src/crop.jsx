import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Check, X, ZoomIn } from 'lucide-react'
import {
  CROP_OUTPUT_SIZE, MAX_ZOOM, MIN_ZOOM, clamp, clampOffset, cropRect, offsetBounds,
} from './cropMath.js'

/* ================================================================ CROPPER ==
   Квадратная обрезка аватарки без сторонних библиотек.

   Показ: картинка лежит в квадратном окне с overflow:hidden и двигается
   transform'ом. Геометрия считается в пикселях исходника, поэтому итоговый
   canvas 512×512 получается ровно тем кадром, который человек видит:
   перетаскивание пальцем/мышью + масштаб (слайдер, колесо, пинч). */

export function AvatarCropModal({ src, onCancel, onApply, busy = false }) {
  const boxRef = useRef(null)
  const imgRef = useRef(null)
  const pointers = useRef(new Map())
  const pinch = useRef(null)
  const drag = useRef(null)

  const [box, setBox] = useState(280)
  const [nat, setNat] = useState({ w: 0, h: 0 })
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [ready, setReady] = useState(false)

  // Размер окна: квадрат, который реально занимает место в раскладке.
  useEffect(() => {
    const el = boxRef.current
    if (!el) return undefined
    const measure = () => setBox(el.clientWidth || 280)
    measure()
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(measure)
      ro.observe(el)
      return () => ro.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const { maxX, maxY } = offsetBounds(nat, box, zoom)
  const k = nat.w && nat.h ? (box / Math.min(nat.w, nat.h)) * zoom : 1
  const dispW = nat.w * k
  const dispH = nat.h * k

  // Держим кадр внутри картинки при любом зуме.
  useEffect(() => {
    setOffset((o) => {
      const next = clampOffset(o, nat, box, zoom)
      return next.x === o.x && next.y === o.y ? o : next
    })
  }, [maxX, maxY])

  const onLoad = (e) => {
    const img = e.currentTarget
    setNat({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 })
    setReady(true)
  }

  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

  const onPointerDown = (e) => {
    if (busy) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) {
      drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: distance(a, b) || 1, zoom }
      drag.current = null
    }
  }

  const onPointerMove = (e) => {
    if (busy || !pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const next = clamp(pinch.current.zoom * (distance(a, b) / pinch.current.dist), MIN_ZOOM, MAX_ZOOM)
      setZoom(Number(next.toFixed(3)))
      return
    }
    if (drag.current) {
      setOffset({
        x: clamp(drag.current.ox + (e.clientX - drag.current.x), -maxX, maxX),
        y: clamp(drag.current.oy + (e.clientY - drag.current.y), -maxY, maxY),
      })
    }
  }

  const endPointer = (e) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) drag.current = null
    else if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()]
      drag.current = { x: p.x, y: p.y, ox: offset.x, oy: offset.y }
    }
  }

  // Колесо мыши — плавный зум на десктопе.
  const onWheel = (e) => {
    if (busy) return
    e.preventDefault()
    setZoom((z) => clamp(Number((z - e.deltaY * 0.0015).toFixed(3)), MIN_ZOOM, MAX_ZOOM))
  }

  const apply = useCallback(async () => {
    const img = imgRef.current
    if (!img || !nat.w || !nat.h) return
    const { sx, sy, side } = cropRect({ nat, box, zoom, offset })

    const canvas = document.createElement('canvas')
    canvas.width = CROP_OUTPUT_SIZE
    canvas.height = CROP_OUTPUT_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) { onCancel(); return }
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, sx, sy, side, side, 0, 0, CROP_OUTPUT_SIZE, CROP_OUTPUT_SIZE)

    let blob = await new Promise((resolve) => { canvas.toBlob(resolve, 'image/webp', 0.9) })
    if (!blob) blob = await new Promise((resolve) => { canvas.toBlob(resolve, 'image/jpeg', 0.9) })
    if (!blob) { onCancel(); return }

    const type = blob.type || 'image/webp'
    const ext = type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpg' : 'webp'
    onApply(new File([blob], `avatar.${ext}`, { type }))
  }, [box, nat, offset.x, offset.y, onApply, onCancel, zoom])

  return (
    <div className="cropper" role="dialog" aria-modal="true" aria-label="Обрезка фото профиля">
      <div className="cropper__head">
        <strong>Фото профиля</strong>
        <button type="button" className="icon-btn" onClick={onCancel} aria-label="Закрыть"><X size={20} /></button>
      </div>

      <div
        ref={boxRef}
        className="cropper__box"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={endPointer}
        onWheel={onWheel}
      >
        <img
          ref={imgRef}
          src={src}
          alt=""
          draggable={false}
          onLoad={onLoad}
          style={ready ? {
            width: `${dispW}px`,
            height: `${dispH}px`,
            transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
          } : { opacity: 0 }}
        />
        <span className="cropper__ring" aria-hidden="true" />
      </div>

      <div className="cropper__zoom">
        <ZoomIn size={16} />
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step="0.01"
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          aria-label="Масштаб"
        />
      </div>
      <p className="cropper__hint">Двигай фото пальцем или мышью, масштаб — ползунком.</p>

      <div className="cropper__actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>Отмена</button>
        <button type="button" className="btn btn--primary" onClick={apply} disabled={busy || !ready}>
          <Check size={16} /> {busy ? 'Загрузка…' : 'Сохранить'}
        </button>
      </div>
    </div>
  )
}
