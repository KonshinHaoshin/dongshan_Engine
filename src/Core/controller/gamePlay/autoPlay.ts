// import {logger} from '../../util/logger';
import styles from '@/UI/BottomControlPanel/bottomControlPanel.module.scss';
import { webgalStore } from '@/store/store';
import { nextSentence } from '@/Core/controller/gamePlay/nextSentence';
import autoPNG from '@/assets/png/auto.png';
import { WebGAL } from '@/Core/WebGAL';

/**
 * 设置 autoplay 按钮的激活与否
 * @param on
 */
const setButton = (on: boolean) => {
  const autoIcon = document.getElementById('Button_ControlPanel_auto');
  if (autoIcon) {
    if (on) {
      autoIcon.className = styles.button_on;
    } else autoIcon.className = styles.singleButton;
  }
};

/**
 * 停止自动播放
 */
export const stopAuto = () => {
  WebGAL.gameplay.isAuto = false;
  setButton(false);
  removeAutoIcon();
  if (WebGAL.gameplay.autoInterval !== null) {
    clearInterval(WebGAL.gameplay.autoInterval);
    WebGAL.gameplay.autoInterval = null;
  }
  if (WebGAL.gameplay.autoTimeout !== null) {
    clearTimeout(WebGAL.gameplay.autoTimeout);
    WebGAL.gameplay.autoTimeout = null;
  }
};

/**
 * 切换自动播放状态
 */
export const switchAuto = () => {
  if (WebGAL.gameplay.isAuto) {
    stopAuto();
    removeAutoIcon(); // ❌ 关闭时移除图标
  } else {
    WebGAL.gameplay.isAuto = true;
    setButton(true);
    insertAutoIcon(); // ✅ 打开时插入图标
    WebGAL.gameplay.autoInterval = setInterval(autoPlay, 100);
  }
};

export const autoNextSentence = () => {
  nextSentence();
  WebGAL.gameplay.autoTimeout = null;
};

/**
 * 自动播放的执行函数
 */
const autoPlay = () => {
  const data = webgalStore.getState().userData.optionData.autoSpeed;
  // 范围为 [250, 1750]
  const autoPlayDelay = 250 + (100 - data) * 15;
  let isBlockingAuto = false;
  WebGAL.gameplay.performController.performList.forEach((e) => {
    if (e.blockingAuto())
      // 阻塞且没有结束的演出
      isBlockingAuto = true;
  });
  if (isBlockingAuto) {
    // 有阻塞，提前结束
    return;
  }
  // nextSentence();
  if (WebGAL.gameplay.autoTimeout === null) {
    WebGAL.gameplay.autoTimeout = setTimeout(autoNextSentence, autoPlayDelay);
  }
};

const AUTO_ICON_ID = 'WebGAL_Auto_Icon';

const insertAutoIcon = () => {
  const existing = document.getElementById(AUTO_ICON_ID);
  if (existing) return; // 已经存在就不重复插了

  const img = document.createElement('img');
  img.src = autoPNG; // auto 按钮
  img.id = AUTO_ICON_ID;
  img.alt = 'AUTO';
  img.style.position = 'absolute';
  img.style.bottom = '80px';
  img.style.left = '110px';
  img.style.width = '100px';
  img.style.zIndex = '9999';
  img.style.pointerEvents = 'none';
  img.style.opacity = '0.9';
  img.style.animation = 'autoIconFloat 1.5s ease-in-out infinite alternate';

  document.body.appendChild(img);
};

const removeAutoIcon = () => {
  const existing = document.getElementById(AUTO_ICON_ID);
  if (existing) {
    existing.remove();
  }
};
