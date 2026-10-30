import React, { useEffect, useState } from 'react'
import {
  RefreshCw, Search, Users, UserRound, Send, Ticket, ShieldCheck,
  Database, Trophy, Activity, CheckCheck, Image as ImageIcon, Gamepad2,
} from 'lucide-react'
import { BackHeader, CloseIcon } from './ui.jsx'

/* ================================================================ charts ==
   Tiny dependency-free charts: plain SVG, scaled by CSS to the container.
   Kept dumb on purpose — the admin panel must stay readable on a phone. */

function num(value) {
  return Number(value || 0).toLocaleString('ru-RU')
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return '—' }
}

function fmtBytes(bytes) {
  const b = Number(bytes || 0)
  if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(2) + ' ГБ'
  if (b >= 1024 ** 2) return (b / 1024 ** 2).toFixed(1) + ' МБ'
  if (b >= 1024) return Math.round(b / 1024) + ' КБ'
  return b + ' Б'
}

function pct(part, total) {
  if (!total) return 0
  return Math.round((Number(part || 0) / Number(total)) * 100)
}

/* 30-day timeline: filled area = registrations, line = profile updates. */
function Timeline({ series }) {
  const data = Array.isArray(series) ? series : []
  const W = 320
  const H = 132
  const padX = 6
  const padTop = 12
  const padBottom = 20

  if (data.length === 0) {
    return <p className="dash-empty">Данных за 30 дней пока нет.</p>
  }

  const max = Math.max(1, ...data.map((d) => Math.max(Number(d.signups) || 0, Number(d.active) || 0)))
  const stepX = data.length > 1 ? (W - padX * 2) / (data.length - 1) : 0
  const x = (i) => padX + i * stepX
  const y = (v) => H - padBottom - ((Number(v) || 0) / max) * (H - padTop - padBottom)

  const line = data
    .map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.active).toFixed(1)}`)
    .join(' ')
  const area = `M${x(0).toFixed(1)},${H - padBottom} `
    + data.map((d, i) => `L${x(i).toFixed(1)},${y(d.signups).toFixed(1)}`).join(' ')
    + ` L${x(data.length - 1).toFixed(1)},${H - padBottom} Z`

  const gridY = [0, 0.5, 1].map((k) => padTop + k * (H - padTop - padBottom))
  const tickIndexes = data.length > 3
    ? [0, Math.floor(data.length / 2), data.length - 1]
    : data.map((_, i) => i)

  return (
    <div className="dash-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="График активности за 30 дней">
        <defs>
          <linearGradient id="dashArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff4b12" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#ff4b12" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {gridY.map((gy) => (
          <line key={gy} x1={padX} x2={W - padX} y1={gy} y2={gy} stroke="var(--line-soft)" strokeWidth="1" />
        ))}
        <path d={area} fill="url(#dashArea)" stroke="var(--orange)" strokeWidth="1.6" strokeLinejoin="round" />
        <path d={line} fill="none" stroke="var(--gold)" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
        {tickIndexes.map((i) => (
          <text key={i} x={Math.min(W - 14, Math.max(14, x(i)))} y={H - 5} textAnchor="middle" fontSize="8" fill="var(--dim)">
            {data[i].label}
          </text>
        ))}
        <text x={padX} y={padTop - 3} fontSize="8" fill="var(--dim)">макс {max}</text>
      </svg>
      <div className="dash-legend">
        <span><i className="dash-dot dash-dot--orange" />Регистрации</span>
        <span><i className="dash-dot dash-dot--gold" />Активность</span>
      </div>
    </div>
  )
}

/* Ring with a percentage in the middle. */
function Donut({ value, total, caption, color = 'var(--orange)' }) {
  const share = total > 0 ? Math.min(1, Number(value || 0) / Number(total)) : 0
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <div className="dash-donut">
      <svg viewBox="0 0 72 72" role="img" aria-label={`${caption}: ${Math.round(share * 100)}%`}>
        <circle cx="36" cy="36" r={r} fill="none" stroke="var(--line)" strokeWidth="8" />
        <circle
          cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${(c * share).toFixed(1)} ${c.toFixed(1)}`}
          transform="rotate(-90 36 36)"
        />
        <text x="36" y="40" textAnchor="middle" fontSize="15" fontWeight="800" fill="var(--text)">
          {Math.round(share * 100)}%
        </text>
      </svg>
      <span>{caption}</span>
    </div>
  )
}

/* Horizontal bars for categorical breakdowns. */
function Bars({ items, total, emptyText = 'Нет данных' }) {
  const list = Array.isArray(items) ? items : []
  const max = Math.max(1, ...list.map((i) => Number(i.count) || 0))
  if (list.length === 0) return <p className="dash-empty">{emptyText}</p>
  return (
    <div className="dash-bars">
      {list.map((item) => (
        <div key={item.label} className="dash-bar">
          <div className="dash-bar__head">
            <span>{item.label}</span>
            <b>{num(item.count)}{total ? <em> · {pct(item.count, total)}%</em> : null}</b>
          </div>
          <div className="dash-bar__track">
            <i style={{ width: `${Math.max(4, (Number(item.count) / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function Kpi({ icon: Icon, value, label, tone = '' }) {
  return (
    <div className={`kpi ${tone ? 'kpi--' + tone : ''}`}>
      <Icon size={15} />
      <b>{value}</b>
      <span>{label}</span>
    </div>
  )
}

function Card({ title, hint, children, action }) {
  return (
    <section className="dash-card">
      <header className="dash-card__head">
        <div>
          <h3>{title}</h3>
          {hint ? <small>{hint}</small> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

/* ------------------------------------------------------------------ detail */
function AdminDetail({ row, onClose }) {
  if (!row) return null
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal__card modal__card--tall" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal__close" onClick={onClose}><CloseIcon /></button>
        <div className="modal__avatar">
          {row.avatar_url
            ? <img src={row.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
            : (row.nick?.[0] || '?').toUpperCase()}
        </div>
        <h3>{row.nick || 'Без ника'}</h3>
        <p className="modal__role">Game ID • {row.game_id || '—'}</p>
        <div className="admin-detail">
          {[
            ['Ранг', row.rank],
            ['PTS', row.pts],
            ['Роли', (row.roles || []).join(', ')],
            ['Серверы', (row.regions || []).join(', ')],
            ['Герои', (row.heroes || []).join(', ')],
            ['Классы', (row.hero_classes || []).join(', ')],
            ['Соцсети', (row.socials || []).join(', ')],
            ['Возраст', row.age],
            ['Пол', row.gender],
            ['Обновлён', fmtDate(row.updated_at)],
            ['Бан', row.is_banned ? (row.ban_reason || 'да') : 'нет'],
          ].map(([label, value]) => (
            <div key={label} className="admin-detail__line"><span>{label}</span><b>{value || '—'}</b></div>
          ))}
          {row.bio ? <p className="admin-detail__bio">{row.bio}</p> : null}
          {(row.screenshot_urls || []).length > 0 && (
            <div className="shots-grid">
              {(row.screenshot_urls || []).map((src, i) => (
                <div key={i} className="shot-thumb"><img src={src} alt={`Скриншот ${i + 1}`} /></div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ================================================================= screen == */
export function AdminScreen({ supabase, isAdmin, onBack }) {
  const [rows, setRows] = useState(null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [statsError, setStatsError] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)

  const load = async () => {
    if (!supabase || !isAdmin) return
    setLoading(true); setError(''); setStatsError('')

    const [listRes, statsRes] = await Promise.all([
      supabase.from('player_profiles').select('*').order('updated_at', { ascending: false }).limit(100),
      supabase.rpc('admin_stats'),
    ])

    setLoading(false)
    if (listRes.error) setError('Не удалось загрузить пользователей: ' + listRes.error.message)
    else setRows(listRes.data || [])

    if (statsRes.error) {
      setStatsError('Сводная статистика недоступна: ' + statsRes.error.message)
      setStats(null)
    } else {
      setStats(statsRes.data || null)
    }
  }

  useEffect(() => {
    if (isAdmin && rows === null && !loading) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  if (!supabase || !isAdmin) {
    return (
      <div className="screen admin">
        <BackHeader title="Админка" onBack={onBack} />
        <div className="empty-block">
          <p>{!supabase ? 'Нет подключения к серверу.' : 'Нет доступа. Этот раздел только для администраторов.'}</p>
          <button type="button" className="btn btn--ghost" onClick={onBack}>На главную</button>
        </div>
      </div>
    )
  }

  const totals = stats?.totals || null
  const profilesTotal = totals?.profiles ?? 0
  const q = query.trim().toLowerCase()
  const filtered = (rows || []).filter((r) =>
    !q || (r.nick || '').toLowerCase().includes(q) || (r.game_id || '').toLowerCase().includes(q))

  const signups30 = (stats?.series || []).reduce((sum, d) => sum + (Number(d.signups) || 0), 0)
  const active30 = (stats?.series || []).reduce((sum, d) => sum + (Number(d.active) || 0), 0)

  return (
    <div className="screen admin">
      <BackHeader
        title="Админка"
        onBack={onBack}
        right={<button type="button" className="icon-btn" onClick={load} title="Обновить"><RefreshCw size={18} /></button>}
      />
      <p className="screen-subtitle">Статистика проекта и все пользователи</p>

      {loading && <p className="field-hint">Загрузка…</p>}
      {error && <p role="alert" className="field-hint">{error}</p>}
      {statsError && <p role="alert" className="field-hint">{statsError}</p>}

      {totals && (
        <>
          <div className="kpi-grid">
            <Kpi icon={Users} value={num(totals.users)} label="Аккаунтов" />
            <Kpi icon={UserRound} value={num(totals.profiles)} label="Профилей" />
            <Kpi icon={CheckCheck} value={num(totals.complete)} label="Заполнено полностью" tone="green" />
            <Kpi icon={Send} value={num(totals.telegram)} label="Telegram привязан" />
            <Kpi icon={Ticket} value={num(totals.tickets_open)} label="Открытых заявок" tone={totals.tickets_open > 0 ? 'warn' : ''} />
            <Kpi icon={ShieldCheck} value={num(totals.reviews_pending)} label="На проверке" tone={totals.reviews_pending > 0 ? 'warn' : ''} />
          </div>

          <Card
            title="Активность за 30 дней"
            hint={`${num(signups30)} регистраций · ${num(active30)} обновлений профилей`}
          >
            <Timeline series={stats?.series} />
            <div className="dash-row">
              <span>Сегодня</span><b>+{num(totals.signups_today)} аккаунтов</b>
            </div>
            <div className="dash-row">
              <span>За 7 дней</span><b>+{num(totals.signups_7d)} аккаунтов</b>
            </div>
            <div className="dash-row">
              <span>За 30 дней</span><b>+{num(totals.signups_30d)} аккаунтов</b>
            </div>
            <div className="dash-row">
              <span>Активны за сутки</span><b>{num(totals.active_24h)} профилей</b>
            </div>
          </Card>

          <div className="dash-two">
            <Card title="Заполненность" hint="Доля от всех профилей">
              <div className="dash-donuts">
                <Donut value={totals.complete} total={profilesTotal} caption="Полный профиль" />
                <Donut value={totals.with_avatar} total={profilesTotal} caption="Есть фото" color="var(--gold)" />
              </div>
              <Bars
                total={profilesTotal}
                items={[
                  { label: 'Ник', count: totals.with_nick },
                  { label: 'Game ID', count: totals.with_game_id },
                  { label: 'Фото', count: totals.with_avatar },
                  { label: 'Скриншоты', count: totals.with_screenshots },
                ]}
              />
            </Card>

            <Card title="Заявки и проверки">
              {totals.tickets_total === 0 && totals.reviews_pending + totals.reviews_approved + totals.reviews_rejected === 0 ? (
                <p className="dash-empty">Пока ни одной заявки и ни одной проверки.</p>
              ) : null}
              <div className="dash-status">
                <span className="dash-status__label">Поддержка</span>
                <div className="dash-status__line">
                  <b>{num(totals.tickets_open)}</b><span>открыто</span>
                  <b>{num(totals.tickets_answered)}</b><span>ответили</span>
                  <b>{num(totals.tickets_closed)}</b><span>закрыто</span>
                </div>
              </div>
              <div className="dash-status">
                <span className="dash-status__label">Проверка контента</span>
                <div className="dash-status__line">
                  <b>{num(totals.reviews_pending)}</b><span>ждёт</span>
                  <b>{num(totals.reviews_approved)}</b><span>ок</span>
                  <b>{num(totals.reviews_rejected)}</b><span>отклонено</span>
                </div>
              </div>
              <div className="dash-row">
                <span>Средний PTS</span><b>{num(totals.avg_pts)}</b>
              </div>
              <div className="dash-row">
                <span>Максимальный PTS</span><b>{num(totals.max_pts)}</b>
              </div>
              <div className="dash-row">
                <span>Скриншотов на профиль</span><b>{String(totals.avg_screenshots).replace('.', ',')}</b>
              </div>
            </Card>
          </div>

          <Card title="Ранги игроков" hint={`${num(profilesTotal)} профилей`}>
            <Bars items={stats?.ranks} total={profilesTotal} emptyText="Никто ещё не указал ранг." />
          </Card>

          <div className="dash-two">
            <Card title="Серверы">
              <Bars items={stats?.regions} emptyText="Серверы не выбраны." />
            </Card>
            <Card title="Роли">
              <Bars items={stats?.roles} emptyText="Роли не выбраны." />
            </Card>
          </div>

          <Card title="Топ игроков" hint="По PTS">
            {(stats?.top_players || []).length === 0
              ? <p className="dash-empty">Игроков пока нет.</p>
              : (
                <div className="dash-table">
                  {(stats?.top_players || []).map((p, i) => (
                    <div key={p.nick + i} className="dash-table__row">
                      <span className="dash-table__num">{i + 1}</span>
                      <span className="dash-table__name">{p.nick}</span>
                      <span className="dash-table__meta">{p.rank}</span>
                      <b>{num(p.pts)}</b>
                    </div>
                  ))}
                </div>
              )}
          </Card>

          <Card title="Последняя активность">
            {(stats?.latest || []).length === 0
              ? <p className="dash-empty">Пока пусто.</p>
              : (
                <div className="dash-table">
                  {(stats?.latest || []).map((p, i) => (
                    <div key={p.nick + i} className="dash-table__row">
                      <span className="dash-table__num"><Activity size={13} /></span>
                      <span className="dash-table__name">{p.nick}</span>
                      <span className="dash-table__meta">{p.rank}</span>
                      <b>{fmtDate(p.at)}</b>
                    </div>
                  ))}
                </div>
              )}
          </Card>

          <div className="dash-foot">
            <span><Database size={13} /> База данных: {fmtBytes(totals.db_size_bytes)}</span>
            <span><Trophy size={13} /> Админов: {num(totals.admins)} · забанено: {num(totals.banned)}</span>
            <span><Gamepad2 size={13} /> Не подтвердили почту: {num(totals.unconfirmed)}</span>
            <span><ImageIcon size={13} /> Обновлено: {fmtDate(stats?.generated_at)}</span>
          </div>
        </>
      )}

      <h3 className="dash-section">Пользователи</h3>
      <div className="admin-search">
        <Search size={17} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по нику или Game ID" />
      </div>

      {rows && rows.length === 0 && !loading && (
        <div className="empty-block"><p>Пользователей пока нет. Как только кто-то заполнит анкету — появится здесь.</p></div>
      )}
      {rows && rows.length > 0 && filtered.length === 0 && (
        <div className="empty-block"><p>Ничего не найдено.</p></div>
      )}

      <div className="admin-list">
        {filtered.map((r) => (
          <button key={r.user_id} type="button" className="admin-row" onClick={() => setSelected(r)}>
            <span className="admin-row__avatar">
              {r.avatar_url ? <img src={r.avatar_url} alt="" /> : (r.nick?.[0] || '?').toUpperCase()}
            </span>
            <span className="admin-row__info">
              <strong>{r.nick || 'Без ника'}</strong>
              <small>{r.game_id ? `Game ID • ${r.game_id}` : 'Game ID не привязан'}{r.rank ? ` · ${r.rank}` : ''}</small>
            </span>
            <span className="admin-row__meta">{fmtDate(r.updated_at)}</span>
          </button>
        ))}
      </div>

      {selected && <AdminDetail row={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
