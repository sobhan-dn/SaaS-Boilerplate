import type { Team } from '../config';
import { TEAM_COLORS } from '../config';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class HUD {
  private root = $('hud');
  private scoreBlue = $('score-blue');
  private scoreOrange = $('score-orange');
  private clock = $('clock');
  private clockWrap = this.clock.parentElement as HTMLElement;
  private clockTag = $('clock-tag');
  private shapeIcon = $('shape-icon');
  private shapeName = $('shape-name');
  private shapeNext = $('shape-next');
  private shapeCountdown = $('shape-countdown');
  private shapeProgress = document.getElementById('shape-progress') as unknown as SVGCircleElement;
  private shapePanel = document.querySelector('.shape-panel') as HTMLElement;
  private boostProgress = document.getElementById('boost-progress') as unknown as SVGCircleElement;
  private boostNum = $('boost-num');
  private boostGauge = document.querySelector('.boost-gauge') as HTMLElement;
  private speedNum = $('speed-num');
  private speedWrap = this.speedNum.parentElement as HTMLElement;
  private centerMsg = $('center-msg');
  private subMsg = $('sub-msg');
  private goalBanner = $('goal-banner');
  private goalScorer = $('goal-scorer');
  private feed = $('event-feed');
  private lastCenter = '';

  show(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  setScore(blue: number, orange: number) {
    this.scoreBlue.textContent = String(blue);
    this.scoreOrange.textContent = String(orange);
  }

  setClock(seconds: number, overtime: boolean, stoppage: boolean) {
    const s = Math.max(0, Math.ceil(seconds));
    const m = Math.floor(s / 60);
    this.clock.textContent = overtime ? `+${m}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
    this.clockTag.textContent = overtime ? 'OVERTIME' : stoppage ? '+TIME' : '';
    this.clockWrap.classList.toggle('urgent', !overtime && seconds <= 30 && seconds > 0);
  }

  setShape(currentName: string, currentIcon: string, nextName: string, secondsLeft: number, interval: number) {
    this.shapeIcon.textContent = currentIcon;
    this.shapeName.textContent = currentName;
    this.shapeNext.textContent = nextName;
    this.shapeCountdown.textContent = String(Math.max(0, Math.ceil(secondsLeft)));
    const frac = interval > 0 ? Math.max(0, Math.min(1, secondsLeft / interval)) : 1;
    this.shapeProgress.style.strokeDashoffset = String(276.5 * (1 - frac));
  }

  flashShape() {
    this.shapePanel.classList.remove('morphing');
    void this.shapePanel.offsetWidth;
    this.shapePanel.classList.add('morphing');
  }

  setBoost(boost: number) {
    this.boostNum.textContent = String(Math.round(boost));
    this.boostProgress.style.strokeDashoffset = String(263.9 * (1 - boost / 100));
    this.boostGauge.classList.toggle('full', boost >= 99.5);
  }

  setSpeed(mps: number, supersonic: boolean) {
    this.speedNum.textContent = String(Math.round(mps * 3.6));
    this.speedWrap.classList.toggle('supersonic', supersonic);
  }

  setCenter(text: string, sub = '') {
    if (text !== this.lastCenter) {
      this.centerMsg.textContent = text;
      this.centerMsg.classList.remove('pop');
      if (text) {
        void this.centerMsg.offsetWidth;
        this.centerMsg.classList.add('pop');
      }
      this.lastCenter = text;
    }
    this.subMsg.textContent = sub;
  }

  showGoal(team: Team, scorer: string) {
    this.goalBanner.classList.remove('hidden', 'blue', 'orange');
    this.goalBanner.classList.add(team === 0 ? 'blue' : 'orange');
    this.goalScorer.textContent = scorer;
  }

  hideGoal() {
    this.goalBanner.classList.add('hidden');
  }

  event(text: string, team?: Team) {
    const el = document.createElement('div');
    el.className = 'ev' + (team !== undefined ? (team === 0 ? ' blue' : ' orange') : '');
    el.textContent = text;
    this.feed.appendChild(el);
    while (this.feed.children.length > 4) this.feed.removeChild(this.feed.firstChild!);
    setTimeout(() => {
      el.style.transition = 'opacity 0.5s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 500);
    }, 4000);
  }

  clearFeed() {
    this.feed.innerHTML = '';
  }

  teamName(team: Team) {
    return TEAM_COLORS[team].name;
  }
}
