import React from 'react';
import styles from './ImageTextbox.module.scss';
import textbox from '@/assets/png/textbox.png';

export default function ImageTextbox(props: any) {
  const { textArray, fontSize, font, showName, isHasName, textboxOpacity } = props;

  return (
    <div className={styles.container} style={{ opacity: textboxOpacity }}>
      {/* 背景图 */}
      <img className={styles.bgImage} src={textbox} alt="Textbox Background" />

      {/* 文本区域（包含名字与正文） */}
      <div className={styles.textboxRegion} style={{ fontFamily: font }}>
        <div className={styles.nameBox}>
          {isHasName
            ? showName?.[0]?.map((node: any, idx: number) => <span key={idx}>{node.reactNode}</span>)
            : null}
        </div>

        <div className={styles.textArea}>
          {textArray.map((line: any, lineIndex: number) => (
            <div key={lineIndex}>
              {line.map((item: any, charIndex: number) => {
                const delay = charIndex * 30;
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
    </div>
  );
}
