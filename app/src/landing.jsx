import React from 'react'
import {
  ArrowRight, Swords, Server, Bot, Mic, ShieldCheck, Trophy, Download,
  Smartphone, ChevronRight, Sparkles, Coins, Play,
} from 'lucide-react'
import { Logo, AppFrame, BrandMark, PrimaryButton, StatBadge } from './ui.jsx'
import { AuthScreen } from './screens.jsx'
import { FEATURES, STEPS } from './data.js'

const ICONS = { swords: Swords, server: Server, bot: Bot, mic: Mic, shield: ShieldCheck, trophy: Trophy }

export function Landing({ onOpen, onOpenScreen, onLogin, gameId, setGameId, gameServer, setGameServer, callbackError, screensCount = 8 }) {
  const scroll = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="landing">
      <header className="site-head">
        <Logo />
        <nav>
          <button type="button" onClick={() => scroll('features')}>Возможности</button>
          <button type="button" onClick={() => scroll('how')}>Как это работает</button>
          <button type="button" onClick={() => scroll('prizes')}>Призы</button>
          <button type="button" onClick={() => scroll('ads')}>Партнёрам</button>
        </nav>
        <button type="button" className="site-head__cta" onClick={onOpen}>
          Открыть приложение <ArrowRight size={16} />
        </button>
      </header>

      <section className="hero-site">
        <div className="hero-site__copy">
          <span className="eyebrow"><Sparkles size={14} /> Платформа открыта для игроков</span>
          <h1>
            <span>Играй.</span>
            <span>Побеждай.</span>
            <span className="accent">Зарабатывай.</span>
          </h1>
          <p className="hero-site__lead">
            Соревновательный матчмейкинг <b>Mobile Legends: Bang Bang</b>: честный драфт
            игроков, выбор сервера, автоматические лобби и зарплата за топ-10 рейтинга.
          </p>
          <div className="hero-site__buttons">
            <button type="button" className="btn btn--primary btn--glow" onClick={onOpen}>
              <Smartphone size={18} /> Открыть приложение
            </button>
            <button type="button" className="btn btn--outline" onClick={() => scroll('how')}>
              <Play size={17} /> Как это работает
            </button>
          </div>
          <div className="hero-site__facts">
            <div><b>10</b><span>игроков в лобби</span></div>
            <div><b>2</b><span>капитана драфтят</span></div>
            <div><b>20 000 ₽</b><span>первое место в месяц</span></div>
          </div>
          <div className="hero-site__trust">
            <ShieldCheck size={16} /> Античит и верификация каждого игрока
          </div>
        </div>

        <div className="hero-site__phone">
          <div className="hero-site__glow" />
          <AppFrame className="appframe--hero">
            <AuthScreen gameId={gameId} setGameId={setGameId} gameServer={gameServer} setGameServer={setGameServer} callbackError={callbackError} onLogin={onLogin || onOpen} />
          </AppFrame>
          <button type="button" className="hero-site__hint" onClick={onOpenScreen}>
            <ChevronRight size={15} /> Все {screensCount} экранов приложения — в интерактивном режиме
          </button>
        </div>
      </section>

      <section className="section" id="features">
        <span className="section__eyebrow">ВОЗМОЖНОСТИ</span>
        <h2 className="section__title">Всё, чего нет в обычном подборе MLBB</h2>
        <p className="section__lead">Из презентации заказчика: продукт, в котором игрок сам влияет на то, с кем играет.</p>
        <div className="feature-grid">
          {FEATURES.map((f) => {
            const Icon = ICONS[f.icon] || Swords
            return (
              <article key={f.title} className="feature-card">
                <span className="feature-card__icon"><Icon size={22} /></span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            )
          })}
        </div>
      </section>

      <section className="section section--alt" id="how">
        <span className="section__eyebrow">ПУТЬ ИГРОКА</span>
        <h2 className="section__title">От Game ID до призов за 4 шага</h2>
        <div className="steps-grid">
          {STEPS.map((s) => (
            <article key={s.n} className="step-card">
              <span className="step-card__num">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section" id="prizes">
        <span className="section__eyebrow">ЭКОНОМИКА</span>
        <h2 className="section__title">Играть выгодно</h2>
        <div className="prize-grid">
          <div className="prize-card prize-card--first">
            <span className="prize-card__place">#1</span>
            <b>20 000 ₽</b><span>в месяц</span>
          </div>
          <div className="prize-card"><span className="prize-card__place">#2</span><b>15 000 ₽</b><span>в месяц</span></div>
          <div className="prize-card"><span className="prize-card__place">#3</span><b>10 000 ₽</b><span>в месяц</span></div>
          <div className="prize-card prize-card--info">
            <Coins size={22} />
            <b>Внутриигровые покупки</b>
            <span>Доп. слоты под фото (150 ₽), привязка соцсетей (30 ₽), премиум-оформление профиля.</span>
          </div>
        </div>
      </section>

      <section className="section section--alt" id="ads">
        <div className="ads-box">
          <div>
            <span className="section__eyebrow">ПАРТНЁРАМ</span>
            <h2 className="section__title">Рекламные места в приложении</h2>
            <p className="section__lead">
              Фоновые баннеры, вставки на переходных экранах и интеграции: техподдержка,
              покупка алмазов, ставки и партнёрские предложения — ненавязчиво, в стилистике продукта.
            </p>
          </div>
          <button type="button" className="btn btn--outline" onClick={onOpenScreen}>
            Увидеть баннер в приложении <ArrowRight size={17} />
          </button>
        </div>
      </section>

      <footer className="site-foot">
        <Logo />
        <p>
          NAME · Соревновательный матчмейкинг MLBB.
          <span className="site-foot__legal">
            <a href="./privacy.html">Политика конфиденциальности</a>
            <a href="./terms.html">Условия использования</a>
          </span>
        </p>
        <button type="button" className="site-head__cta" onClick={onOpen}><Download size={16} /> Открыть приложение</button>
      </footer>
    </div>
  )
}
