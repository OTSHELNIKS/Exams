import React from 'react'
import {
  ArrowRight, Swords, Server, Bot, Mic, ShieldCheck, Trophy, Download,
  Smartphone, Sparkles, Play, Users, UserRound, Palette,
} from 'lucide-react'
import { Logo } from './ui.jsx'
import { FEATURES, STEPS } from './data.js'

const ICONS = { swords: Swords, server: Server, bot: Bot, mic: Mic, shield: ShieldCheck, trophy: Trophy }

export function Landing({ onOpen, onOpenScreen, callbackError }) {
  const scroll = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="landing">
      <header className="site-head">
        <Logo />
        <nav>
          <button type="button" onClick={() => scroll('features')}>Возможности</button>
          <button type="button" onClick={() => scroll('how')}>Как это работает</button>
          <button type="button" onClick={() => scroll('prizes')}>Рейтинг</button>
          <button type="button" onClick={() => scroll('ads')}>Партнёрам</button>
        </nav>
        <button type="button" className="site-head__cta" onClick={onOpen}>
          Открыть приложение <ArrowRight size={16} />
        </button>
      </header>

      <section className="hero-site">
        <div className="hero-site__copy">
          <span className="eyebrow"><Sparkles size={14} /> Платформа для игроков MLBB</span>
          <h1>
            <span>Собирай.</span>
            <span>Играй.</span>
            <span className="accent">Побеждай.</span>
          </h1>
          <p className="hero-site__lead">
            Профиль, лобби и рейтинг для игроков <b>Mobile Legends: Bang Bang</b>.
            Собери состав с друзьями и подготовься к игре в Custom Room.
          </p>
          <div className="hero-site__buttons">
            <button type="button" className="btn btn--primary btn--glow" onClick={onOpen}>
              <Smartphone size={18} /> Открыть приложение
            </button>
            <button type="button" className="btn btn--outline" onClick={() => scroll('how')}>
              <Play size={17} /> Как это работает
            </button>
          </div>
          <div className="hero-site__trust">
            <ShieldCheck size={16} /> Создай профиль после входа в аккаунт
          </div>
          {callbackError && <p className="hero-site__error" role="alert">{callbackError}</p>}
        </div>

        <div className="product-preview" aria-label="Возможности NAME">
          <div className="product-preview__top"><Logo /><span>ВНУТРИ NAME</span></div>
          <div className="product-preview__intro"><span>ДЛЯ ИГРОКОВ MLBB</span><h2>Твоя команда.<br /><em>Твоя игра.</em></h2><p>Всё необходимое для подготовки к матчу — в одном месте.</p></div>
          <div className="product-preview__items">
            <div><span><UserRound size={20} /></span><section><b>Профиль игрока</b><small>Роли, герои и оформление</small></section><ArrowRight size={16} /></div>
            <div><span><Users size={20} /></span><section><b>Лобби по коду</b><small>Собери игроков и поделись Room ID</small></section><ArrowRight size={16} /></div>
            <div><span><Trophy size={20} /></span><section><b>Рейтинг</b><small>Таблица игроков и история</small></section><ArrowRight size={16} /></div>
            <div><span><Palette size={20} /></span><section><b>Оформление профиля</b><small>Свой стиль и карточка игрока</small></section><ArrowRight size={16} /></div>
          </div>
          <button type="button" className="product-preview__cta" onClick={onOpen}>Открыть приложение <ArrowRight size={16} /></button>
        </div>
      </section>

      <section className="section" id="features">
        <span className="section__eyebrow">ВОЗМОЖНОСТИ</span>
        <h2 className="section__title">Всё для подготовки к игре</h2>
        <p className="section__lead">Собирай состав, оформи профиль и следи за рейтингом в NAME.</p>
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
        <h2 className="section__title">Четыре шага к матчу</h2>
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
        <span className="section__eyebrow">РЕЙТИНГ</span>
        <h2 className="section__title">Следи за своим прогрессом</h2>
        <p className="section__lead">Таблица игроков и история сохраняются. Отправка результатов и начисление очков временно приостановлены, пока мы работаем над их надёжной проверкой.</p>
      </section>

      <section className="section section--alt" id="ads">
        <div className="ads-box">
          <div>
            <span className="section__eyebrow">ПАРТНЁРАМ</span>
            <h2 className="section__title">Рекламные места в приложении</h2>
            <p className="section__lead">
              Возможности сотрудничества и размещения партнёрских материалов обсуждаются отдельно.
            </p>
          </div>
          <button type="button" className="btn btn--outline" onClick={onOpenScreen}>
            Открыть приложение <ArrowRight size={17} />
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
