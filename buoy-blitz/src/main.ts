import { Physics } from './physics/Physics';
import { Game, type MatchResult } from './core/Game';
import { HUD } from './ui/HUD';
import { AudioEngine } from './audio/AudioEngine';
import { TEAM_COLORS, type QualityLevel } from './config';

const $ = (id: string) => document.getElementById(id)!;

const canvas = $('game') as HTMLCanvasElement;
const menu = $('menu');
const pause = $('pause');
const result = $('result');
const loading = $('loading');
const btnPlay = $('btn-play') as HTMLButtonElement;
const optQuality = $('opt-quality') as HTMLSelectElement;
const optDuration = $('opt-duration') as HTMLSelectElement;
const optMorph = $('opt-morph') as HTMLSelectElement;
const optDifficulty = $('opt-difficulty') as HTMLSelectElement;

const hud = new HUD();
const audio = new AudioEngine();
let game: Game | null = null;

const savedQuality = localStorage.getItem('buoy-quality') as QualityLevel | null;
if (savedQuality && ['low', 'medium', 'high', 'ultra'].includes(savedQuality)) optQuality.value = savedQuality;

function matchOptions() {
  return {
    duration: Number(optDuration.value),
    morphInterval: Number(optMorph.value),
    difficulty: Number(optDifficulty.value),
  };
}

function showResult(r: MatchResult) {
  const title = $('result-title');
  if (r.winner === null) title.textContent = 'Draw!';
  else title.textContent = `${TEAM_COLORS[r.winner].name} WINS!`;
  title.style.color = r.winner === null ? '#ffd86b' : TEAM_COLORS[r.winner].css;
  $('result-score').innerHTML = `<span style="color:${TEAM_COLORS[0].css}">${r.score[0]}</span> - <span style="color:${TEAM_COLORS[1].css}">${r.score[1]}</span>`;
  $('result-stats').innerHTML = r.stats
    .map((s) => `<div><b style="color:${TEAM_COLORS[s.team].css}">${s.name}</b><br/>${s.goals} goals · ${s.saves} saves · ${s.touches} touches</div>`)
    .join('');
  result.classList.remove('hidden');
}

async function createGame() {
  btnPlay.disabled = true;
  loading.textContent = 'Loading physics…';
  loading.classList.remove('hidden');
  const physics = await Physics.create();
  loading.textContent = 'Building the arena…';
  await new Promise((r) => requestAnimationFrame(r));
  game?.dispose();
  const quality = optQuality.value as QualityLevel;
  localStorage.setItem('buoy-quality', quality);
  game = new Game(canvas, physics, quality, hud, audio);
  game.onMatchEnd = (r) => {
    hud.show(false);
    showResult(r);
  };
  game.onPause = () => {
    game?.setPaused(true);
    pause.classList.remove('hidden');
  };
  loading.classList.add('hidden');
  btnPlay.disabled = false;
}

btnPlay.addEventListener('click', async () => {
  await audio.init();
  if (!game) await createGame();
  menu.classList.add('hidden');
  game!.startMatch(matchOptions());
});

optQuality.addEventListener('change', () => {
  if (game && game.phase === 'idle') void createGame();
});

$('btn-resume').addEventListener('click', () => {
  pause.classList.add('hidden');
  game?.setPaused(false);
});
$('btn-quit').addEventListener('click', () => {
  pause.classList.add('hidden');
  game?.setPaused(false);
  game?.quitToMenu();
  menu.classList.remove('hidden');
});
$('btn-rematch').addEventListener('click', () => {
  result.classList.add('hidden');
  game?.startMatch(matchOptions());
});
$('btn-menu').addEventListener('click', () => {
  result.classList.add('hidden');
  game?.quitToMenu();
  menu.classList.remove('hidden');
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && !pause.classList.contains('hidden')) {
    pause.classList.add('hidden');
    game?.setPaused(false);
  }
});

void createGame();
