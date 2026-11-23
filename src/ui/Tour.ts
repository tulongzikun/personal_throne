/**
 * 新手引导：四步轻量浮层，纯 DOM + CSS，不引入任何依赖。
 *
 * 首次进入（localStorage 无标记）自动出现；顶栏「?」可随时重看。
 * 浮层本身不拦截点击（pointer-events: none），只在目标周围挖一个高亮洞，
 * 因此玩家可以边看边操作，随时跳过。
 */

const SEEN_KEY = 'throne-and-gold.tour.v1';

interface TourStep {
  /** 高亮目标的 CSS 选择器；null 表示居中显示。 */
  readonly target: string | null;
  readonly title: string;
  readonly body: string;
}

const STEPS: readonly TourStep[] = [
  {
    target: '[data-panel="player"]',
    title: '这是你的角色',
    body: '左栏常驻你的身份卡：现金、所在地区、信仰、职位与持股。点「完整人物」查看六维、阵营与家系。',
  },
  {
    target: '[data-tour="suggestions"]',
    title: '行动力花在哪',
    body: '你每月有 30 点行动力：跑一趟商路、练一门手艺、打听行情都要花。左栏这三条建议是当下最划算的事，点一下就能做，做完会换一批。没主意就读它。',
  },
  {
    target: '[data-panel="map"]',
    title: '事件会找上门',
    body: '时间推进时，世界事件会以弹窗出现；带「你的抉择」的事件需要你点选一个选项，逾期会自动替你决定。地图上的地区可以点开看市场。',
  },
  {
    target: '[data-tour="save"]',
    title: '留下你的传说',
    body: '「存档」管理自动槽与三个手动槽，可覆盖、读取、删除；「导出」保存成 JSON 文件，换机器时用「导入」恢复。',
  },
];

function hasSeenTour(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    // file:// 或隐私模式下 localStorage 可能不可用：当作没看过。
    return false;
  }
}

function markTourSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // 忽略：引导标记写不进去不影响游戏。
  }
}

export class Tour {
  private readonly root: HTMLElement;
  private readonly spot: HTMLElement;
  private readonly card: HTMLElement;
  private readonly stepEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly dotsEl: HTMLElement;
  private readonly prevButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private index = 0;
  private opened = false;
  private returnFocus: HTMLElement | null = null;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'tour';
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');

    this.spot = document.createElement('div');
    this.spot.className = 'tour__spot';
    this.spot.hidden = true;

    this.card = document.createElement('section');
    this.card.className = 'tour__card';
    this.card.tabIndex = -1;
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-labelledby', 'tour-title');
    this.card.setAttribute('aria-describedby', 'tour-body');

    const meta = document.createElement('div');
    meta.className = 'tour__meta';
    this.stepEl = document.createElement('span');
    this.stepEl.className = 'tour__step';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'tour__skip';
    skip.textContent = '跳过';
    skip.setAttribute('aria-label', '跳过新手引导');
    skip.addEventListener('click', () => this.close());
    meta.append(this.stepEl, skip);

    this.titleEl = document.createElement('h2');
    this.titleEl.className = 'tour__title';
    this.titleEl.id = 'tour-title';
    this.bodyEl = document.createElement('p');
    this.bodyEl.className = 'tour__body';
    this.bodyEl.id = 'tour-body';

    const foot = document.createElement('div');
    foot.className = 'tour__foot';
    this.dotsEl = document.createElement('div');
    this.dotsEl.className = 'tour__dots';
    const actions = document.createElement('div');
    actions.className = 'tour__actions';

    this.prevButton = document.createElement('button');
    this.prevButton.type = 'button';
    this.prevButton.className = 'btn btn--small';
    this.prevButton.textContent = '上一步';
    this.prevButton.setAttribute('aria-label', '上一步');
    this.prevButton.addEventListener('click', () => this.go(-1));

    this.nextButton = document.createElement('button');
    this.nextButton.type = 'button';
    this.nextButton.className = 'btn btn--small btn--gold';
    this.nextButton.textContent = '下一步';
    this.nextButton.setAttribute('aria-label', '下一步');
    this.nextButton.addEventListener('click', () => this.go(1));

    actions.append(this.prevButton, this.nextButton);
    foot.append(this.dotsEl, actions);
    this.card.append(meta, this.titleEl, this.bodyEl, foot);

    this.root.append(this.spot, this.card);
    host.append(this.root);

    window.addEventListener('resize', () => {
      if (this.opened) this.layout();
    });
    document.addEventListener(
      'scroll',
      () => {
        if (this.opened) this.layout();
      },
      true,
    );
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** 首次进入时自动出现；已看过则什么都不做。 */
  maybeStart(): void {
    if (this.opened || hasSeenTour()) return;
    window.setTimeout(() => {
      if (!this.opened) this.open();
    }, 900);
  }

  /** 顶栏「?」：从头再看一遍。 */
  restart(): void {
    this.index = 0;
    this.open();
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    const active = document.activeElement;
    this.returnFocus = active instanceof HTMLElement ? active : null;
    this.root.hidden = false;
    this.root.setAttribute('aria-hidden', 'false');
    window.requestAnimationFrame(() => this.root.classList.add('is-open'));
    this.render();
    this.card.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    markTourSeen();
    this.root.classList.remove('is-open');
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');
    this.spot.hidden = true;
    if (this.returnFocus && document.contains(this.returnFocus)) {
      this.returnFocus.focus({ preventScroll: true });
    }
    this.returnFocus = null;
  }

  private go(delta: number): void {
    const next = this.index + delta;
    if (next >= STEPS.length) {
      this.close();
      return;
    }
    this.index = Math.max(0, next);
    this.render();
  }

  private render(): void {
    const step = STEPS[this.index];
    if (!step) return;
    this.stepEl.textContent = `第 ${this.index + 1} / ${STEPS.length} 步`;
    this.titleEl.textContent = step.title;
    this.bodyEl.textContent = step.body;
    this.prevButton.disabled = this.index === 0;
    this.nextButton.textContent = this.index === STEPS.length - 1 ? '完成' : '下一步';
    this.nextButton.setAttribute('aria-label', this.nextButton.textContent);

    this.dotsEl.replaceChildren();
    for (let index = 0; index < STEPS.length; index += 1) {
      const dot = document.createElement('span');
      dot.className = `tour__dot${index === this.index ? ' is-active' : ''}`;
      this.dotsEl.append(dot);
    }

    this.layout();
  }

  /** 把高亮洞对准目标，并把卡片放到空间更宽的一侧。 */
  private layout(): void {
    const step = STEPS[this.index];
    if (!step) return;
    const target = step.target ? document.querySelector<HTMLElement>(step.target) : null;
    const rect = target?.getBoundingClientRect();
    const cardWidth = this.card.offsetWidth;
    const cardHeight = this.card.offsetHeight;
    const gap = 18;
    const margin = 12;

    if (!rect || rect.width < 2 || rect.height < 2) {
      this.spot.hidden = true;
      this.card.style.left = `${Math.max(margin, (window.innerWidth - cardWidth) / 2)}px`;
      this.card.style.top = `${Math.max(margin, (window.innerHeight - cardHeight) / 2)}px`;
      return;
    }

    const pad = 6;
    this.spot.hidden = false;
    this.spot.style.left = `${rect.left - pad}px`;
    this.spot.style.top = `${rect.top - pad}px`;
    this.spot.style.width = `${rect.width + pad * 2}px`;
    this.spot.style.height = `${rect.height + pad * 2}px`;

    const clampTop = Math.min(
      Math.max(margin, rect.top),
      Math.max(margin, window.innerHeight - cardHeight - margin),
    );
    const spaceRight = window.innerWidth - rect.right;
    const spaceLeft = rect.left;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    let left: number;
    let top = clampTop;
    if (spaceRight >= cardWidth + gap + margin) {
      left = rect.right + gap;
    } else if (spaceLeft >= cardWidth + gap + margin) {
      left = rect.left - gap - cardWidth;
    } else if (spaceBelow >= cardHeight + gap + margin) {
      left = rect.left + rect.width / 2 - cardWidth / 2;
      top = rect.bottom + gap;
    } else if (spaceAbove >= cardHeight + gap + margin) {
      left = rect.left + rect.width / 2 - cardWidth / 2;
      top = rect.top - gap - cardHeight;
    } else {
      left = rect.left + rect.width / 2 - cardWidth / 2;
      top = rect.bottom + gap;
    }

    this.card.style.left = `${Math.round(
      Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - cardWidth - margin)),
    )}px`;
    this.card.style.top = `${Math.round(
      Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - cardHeight - margin)),
    )}px`;
  }
}
