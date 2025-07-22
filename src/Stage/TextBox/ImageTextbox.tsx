// /src/Stage/TextBox/ImageTextbox.tsx
import React from 'react';
import styles from './ImageTextbox.module.scss';
import textbox from '@/assets/png/textbox.png';

export default function ImageTextbox(props: any) {
  const { textArray, fontSize, font, showName, isHasName, textboxOpacity } = props;

  return (
    <div className={styles.container} style={{ opacity: textboxOpacity }}>
      {/* 背景图 */}
      <img className={styles.bgImage} src={textbox} alt="Textbox Background" />

      {/* 角色名字 */}
      {isHasName && (
        <div className={styles.nameBox} style={{ fontFamily: font }}>
          {isHasName ? showName?.[0]?.map((node: any, idx: number) => <span key={idx}>{node.reactNode}</span>) : null}
        </div>
      )}

      {/* 对话内容 */}
      <div className={styles.textArea} style={{ fontFamily: font }}>
        {textArray.map((line: any, lineIndex: number) => (
          <div key={lineIndex}>
            {line.map((item: any, charIndex: number) => {
              const delay = charIndex * 30; // 每个字间隔 30ms，和原版一致喵
              return (
                <span
                  key={charIndex}
                  className={styles.char}
                  style={{
                    animationDelay: `${delay}ms`,
                    animationDuration: `0.2s`,
                  }}
                >
                  {item.reactNode}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
