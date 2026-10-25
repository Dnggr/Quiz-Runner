// main.js — bootstrap + screen switching. Everything else lives in its own module.
import { createRouter } from './router.js';
import { initQuickPaste } from './ui/quickpaste.js';

// route name -> screen element id
const SCREEN_IDS = {
  input: 'screen-input',
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

const router = createRouter({
  win: window,
  routes: Object.keys(SCREEN_IDS),
  home: HOME,
  // quiz / export make no sense without loaded questions (e.g. a refresh): go home.
  guard: (route) => ((route.name === 'quiz' || route.name === 'export') && !quickPaste?.hasQuestions() ? HOME : null),
  onRoute: (route) => {
    showScreen(route.name);
    quickPaste.enter(route.name);
  },
});

quickPaste = initQuickPaste(router);
router.start();
