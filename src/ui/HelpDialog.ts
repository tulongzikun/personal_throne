/**
 * 帮助（P0）：按「看 / 做 / 查」分组，而不是把所有按钮平铺一遍。
 *
 * 只讲现在真的有的东西；W3 之后这里的「做」会换成议程选项。
 */

import { el } from './dom';
import { Modal } from './Modal';

export interface HelpHandlers {
  restartTour(): void;
}

const GROUPS: readonly {
  readonly title: string;
  readonly hint: string;
  readonly items: readonly (readonly [string, string])[];
}[] = [
  {
    title: '看',
    hint: '六个标签页各管一件事，同一时间只显示一个面板',
    items: [
      ['地区', '地图点城市，或左侧「前往」；面板里有当地物价与治安'],
      ['人物', '你认识的人、关系与履历；点名字进人物页'],
      ['组织', '你所在行号的账、持股、职位与仇怨'],
      ['国家', '七国的政策、国库、稳定度与战争'],
      ['军团', '各国军队规模与正在打的仗'],
      ['历史', '编年史，默认只看大事，可切换全部'],
    ],
  },
  {
    title: '做',
    hint: '每件事都要花行动力或铜币，做之前先看代价',
    items: [
      ['移动', '地图/地区页点城市 →「前往」，路上可能遇劫（力量检定）'],
      ['贩货', '左栏会算好货种、目的地与预计利润，点一下就走'],
      ['训练', '花铜币把主技能练高，受天赋上限约束'],
      ['休息 / 存取', '回健康、把钱存进钱庄（携带现金会被抢）'],
      ['时间', '每月 30 点行动力；不够时会提示你推时间'],
    ],
  },
  {
    title: '查',
    hint: '键盘能做的事和按钮一样多',
    items: [
      ['1 / 2 / 3', '1× / 7× / 30× 速度'],
      ['4 或 空格', '暂停 / 继续'],
      ['?', '打开这份帮助'],
      ['Esc', '关闭最上层弹窗'],
      ['Tab', '在按钮与面板间移动焦点'],
    ],
  },
];

export class HelpDialog {
  private readonly modal: Modal;

  constructor(
    parent: HTMLElement,
    handlers: HelpHandlers,
    onVisibilityChange?: (visible: boolean) => void,
  ) {
    this.modal = new Modal(parent, {
      onVisibilityChange,
      badge: '帮助',
      title: '这座世界怎么玩',
      lead: '你是金穗行的少东家：钱、人、名分都要自己去挣。左边是你自己，中间是地图，右边是世界的账本。',
      wide: true,
    });

    for (const group of GROUPS) {
      const section = el('section', 'help__group');
      section.append(el('h3', 'help__title', group.title), el('p', 'help__hint', group.hint));
      const list = el('dl', 'help__list');
      for (const [term, text] of group.items) {
        const row = el('div', 'help__row');
        row.append(el('dt', 'help__term', term), el('dd', 'help__text', text));
        list.append(row);
      }
      section.append(list);
      this.modal.body.append(section);
    }

    const tour = el('button', 'btn btn--ghost', '重看新手引导');
    tour.type = 'button';
    tour.addEventListener('click', () => {
      this.modal.close();
      handlers.restartTour();
    });
    const close = el('button', 'btn btn--gold', '知道了');
    close.type = 'button';
    close.addEventListener('click', () => this.modal.close());
    this.modal.actions.append(tour, close);
  }

  open(): void {
    this.modal.open();
  }

  close(): void {
    this.modal.close();
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }
}
