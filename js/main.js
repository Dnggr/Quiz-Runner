// main.js — bootstrap + screen switching. Everything else lives in its own module.
import { createRouter } from './router.js';
import { initQuickPaste } from './ui/quickpaste.js';
import { initLoadScreen } from './ui/loadpack.js';
import { initProblems } from './ui/problems.js';
import { initPreview } from './ui/preview.js';

// route name -> screen element id
const SCREEN_IDS = {
  input: 'screen-input',
  problems: 'screen-problems',
  preview: 'screen-preview',
  quiz: 'screen-quiz',
  export: 'screen-export',
};
const HOME = 'input';

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(SCREEN_IDS[name]).classList.add('active');
  window.scrollTo(0, 0);
}

// The router object is needed by the screens, and the screens are needed by the router's guard,
// so the guard looks the screens up lazily.
let quickPaste = null;
// The latest Quiz Pack load, in memory only (saved to storage in P3-09). Refreshing the page drops it: go home.
let packLoaded = false;
let packProblems = false;

const router = createRouter({
  win: window,
  routes: Object.keys(SCREEN_IDS),
  home: HOME,
  // quiz / export make no sense without loaded questions, preview / problems without a pack result (e.g. a refresh): go home.
  guard: (route) => {
    if ((route.name === 'quiz' || route.name === 'export') && !quickPaste?.hasQuestions()) return HOME;
    if (route.name === 'preview' && !packLoaded) return HOME;
    if (route.name === 'problems' && !packProblems) return HOME;
    return null;
  },
  onRoute: (route) => {
    showScreen(route.name);
    quickPaste.enter(route.name);
  },
});

quickPaste = initQuickPaste(router);

const preview = initPreview({
  onChooseAnother: () => {
    packLoaded = false;
    preview.clear();
    router.navigate(HOME);
  },
});
const problems = initProblems({ onBack: () => router.navigate(HOME) });

function resetPackScreens() {
  packLoaded = false;
  packProblems = false;
  preview.clear();
  problems.clear();
}

initLoadScreen({
  startLegacy: (parsed) => {
    resetPackScreens();
    quickPaste.startLegacy(parsed);
  },
  onPack: (result, note) => {
    resetPackScreens();
    preview.show(result, note);
    packLoaded = true;
    router.navigate('preview');
  },
  onPackProblems: (result, note) => {
    resetPackScreens();
    problems.show(result, note);
    packProblems = true;
    router.navigate('problems');
  },
  isLoadScreenActive: () => router.current?.name === HOME,
});
router.start();
