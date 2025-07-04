import { useEffect, useState } from 'react';
import styles from './introContainer.module.scss';

export default function IntroContainer() {
  const [visible, setVisible] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const timer1 = setTimeout(() => setFadeOut(true), 2500); // 开始淡出动画
    const timer2 = setTimeout(() => setVisible(false), 3000); // 完全移除组件
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, []);

  if (!visible) return null;

  return (
    <div className={`${styles.introContainer} ${fadeOut ? styles.fadeOut : ''}`} id="introContainer">
      <div className={styles.introText}>PROJECT ZERO</div>
    </div>
  );
}
