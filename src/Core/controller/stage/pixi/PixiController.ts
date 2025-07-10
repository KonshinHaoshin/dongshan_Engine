import * as PIXI from 'pixi.js';
import { v4 as uuid } from 'uuid';
import { webgalStore } from '@/store/store';
import { setStage, stageActions } from '@/store/stageReducer';
import cloneDeep from 'lodash/cloneDeep';
import { IEffect, IFigureAssociatedAnimation, IFigureMetadata, IFreeFigure, ITransform } from '@/store/stageInterface';
import { logger } from '@/Core/util/logger';
import { isIOS } from '@/Core/initializeScript';
import { WebGALPixiContainer } from '@/Core/controller/stage/pixi/WebGALPixiContainer';
import { WebGAL } from '@/Core/WebGAL';
import { SCREEN_CONSTANTS } from '@/Core/util/constants';
import { addSpineBgImpl, addSpineFigureImpl } from '@/Core/controller/stage/pixi/spine';
import { AnimatedGIF } from '@pixi/gif';
import { setFreeFigure } from '@/store/stageReducer';

// import { figureCash } from '@/Core/gameScripts/vocal/conentsCash'; // 如果要使用 Live2D，取消这里的注释
// import { Live2DModel, SoundManager } from 'pixi-live2d-display-webgal'; // 如果要使用 Live2D，取消这里的注释

export interface IAnimationObject {
  setStartState: Function;
  setEndState: Function;
  tickerFunc: PIXI.TickerCallback<number>;
  getEndFilterEffect?: Function;
}

interface IStageAnimationObject {
  // 唯一标识
  uuid: string;
  // 一般与作用目标有关
  key: string;
  targetKey?: string;
  type: 'common' | 'preset';
  animationObject: IAnimationObject;
}

export interface IStageObject {
  // 唯一标识
  uuid: string;
  // 一般与作用目标有关
  key: string;
  pixiContainer: WebGALPixiContainer;
  // 相关的源 url
  sourceUrl: string;
  sourceExt: string;
  sourceType: 'img' | 'live2d' | 'spine' | 'gif' | 'video';
  spineAnimation?: string;
}

export interface ILive2DRecord {
  target: string;
  motion: string;
  expression: string;
}

// export interface IRegisterTickerOpr {
//   tickerGeneratorFn: (targetKey: string, duration: number) => PIXI.TickerCallback<number>;
//   key: string;
//   target: string;
//   duration: number;
// }

// @ts-ignore
window.PIXI = PIXI;

export default class PixiStage {
  public static assignTransform<T extends ITransform>(target: T, source?: ITransform) {
    if (!source) return;
    const targetScale = target.scale;
    const targetPosition = target.position;
    if (target.scale) Object.assign(targetScale, source.scale);
    if (target.position) Object.assign(targetPosition, source.position);
    Object.assign(target, source);
    target.scale = targetScale;
    target.position = targetPosition;
  }

  /**
   * 当前的 PIXI App
   */
  public currentApp: PIXI.Application | null = null;
  public readonly foregroundEffectsContainer: PIXI.Container;
  public readonly backgroundEffectsContainer: PIXI.Container;
  public frameDuration = 16.67;
  public notUpdateBacklogEffects = false;
  public readonly figureContainer: PIXI.Container;
  public figureObjects: Array<IStageObject> = [];
  public stageWidth = SCREEN_CONSTANTS.width;
  public stageHeight = SCREEN_CONSTANTS.height;
  public assetLoader = new PIXI.Loader();
  public readonly backgroundContainer: PIXI.Container;
  public backgroundObjects: Array<IStageObject> = [];
  /**
   * 添加 Spine 立绘
   * @param key 立绘的标识，一般和立绘位置有关
   * @param url 立绘图片url
   * @param presetPosition
   */
  public addSpineFigure = addSpineFigureImpl.bind(this);
  public addSpineBg = addSpineBgImpl.bind(this);
  // 注册到 Ticker 上的函数
  private stageAnimations: Array<IStageAnimationObject> = [];
  private loadQueue: { url: string; callback: () => void; name?: string }[] = [];
  private live2dFigureRecorder: Array<ILive2DRecord> = [];
  // 锁定变换对象（对象可能正在执行动画，不能应用变换）
  private lockTransformTarget: Array<string> = [];

  /**
   * 暂时没用上，以后可能用
   * @private
   */
  private MAX_TEX_COUNT = 10;

  private isLive2dAvailable: undefined | boolean = undefined;
  private figureCash: any;
  private live2DModel: any;
  private soundManager: any;

  private loadedJsonlCache: Set<string> = new Set();

  public constructor() {
    const app = new PIXI.Application({
      backgroundAlpha: 0,
      preserveDrawingBuffer: true,
    });
    // @ts-ignore

    window.PIXIapp = this; // @ts-ignore
    window.__PIXI_APP__ = app;
    // 清空原节点
    const pixiContainer = document.getElementById('pixiContianer');
    if (pixiContainer) {
      pixiContainer.innerHTML = '';
      pixiContainer.appendChild(app.view);
    }

    // 设置样式
    app.renderer.view.style.position = 'absolute';
    app.renderer.view.style.display = 'block';
    app.renderer.view.id = 'pixiCanvas';
    // @ts-ignore
    app.renderer.autoResize = true;
    const appRoot = document.getElementById('root');
    if (appRoot) {
      app.renderer.resize(appRoot.clientWidth, appRoot.clientHeight);
    }
    if (isIOS) {
      app.renderer.view.style.zIndex = '-5';
    }

    // 设置可排序
    app.stage.sortableChildren = true;

    // 添加 4 个 Container 用于做渲染
    this.foregroundEffectsContainer = new PIXI.Container(); // 前景特效
    this.foregroundEffectsContainer.zIndex = 3;
    this.figureContainer = new PIXI.Container();
    this.figureContainer.sortableChildren = true; // 允许立绘启用 z-index
    this.figureContainer.zIndex = 2;
    this.backgroundEffectsContainer = new PIXI.Container(); // 背景特效
    this.backgroundEffectsContainer.zIndex = 1;
    this.backgroundContainer = new PIXI.Container();
    this.backgroundContainer.zIndex = 0;

    app.stage.addChild(
      this.foregroundEffectsContainer,
      this.figureContainer,
      this.backgroundEffectsContainer,
      this.backgroundContainer,
    );
    this.currentApp = app;
    // 每 5s 获取帧率，并且防 loader 死
    const update = () => {
      this.updateFps();
      setTimeout(update, 10000);
    };
    update();
    // loader 防死
    const reload = () => {
      setTimeout(reload, 500);
      this.callLoader();
    };
    reload();
    this.initialize().then(() => {});
  }

  public getFigureObjects() {
    return this.figureObjects;
  }

  public getAllLockedObject() {
    return this.lockTransformTarget;
  }

  /**
   * 注册动画
   * @param animationObject
   * @param key
   * @param target
   */
  public registerAnimation(animationObject: IAnimationObject | null, key: string, target = 'default') {
    if (!animationObject) return;
    this.stageAnimations.push({ uuid: uuid(), animationObject, key: key, targetKey: target, type: 'common' });
    // 上锁
    this.lockStageObject(target);
    animationObject.setStartState();
    this.currentApp?.ticker.add(animationObject.tickerFunc);
  }

  /**
   * 注册预设动画
   * @param animationObject
   * @param key
   * @param target
   * @param currentEffects
   */
  // eslint-disable-next-line max-params
  public registerPresetAnimation(
    animationObject: IAnimationObject | null,
    key: string,
    target = 'default',
    currentEffects: IEffect[],
  ) {
    if (!animationObject) return;
    const effect = currentEffects.find((effect) => effect.target === target);
    if (effect) {
      const targetPixiContainer = this.getStageObjByKey(target);
      if (targetPixiContainer) {
        const container = targetPixiContainer.pixiContainer;
        PixiStage.assignTransform(container, effect.transform);
      }
      return;
    }
    this.stageAnimations.push({ uuid: uuid(), animationObject, key: key, targetKey: target, type: 'preset' });
    // 上锁
    this.lockStageObject(target);
    animationObject.setStartState();
    this.currentApp?.ticker.add(animationObject.tickerFunc);
  }

  public stopPresetAnimationOnTarget(target: string) {
    const targetPresetAnimations = this.stageAnimations.find((e) => e.targetKey === target && e.type === 'preset');
    if (targetPresetAnimations) {
      this.removeAnimation(targetPresetAnimations.key);
    }
  }

  /**
   * 移除动画
   * @param key
   */
  public removeAnimation(key: string) {
    const index = this.stageAnimations.findIndex((e) => e.key === key);
    if (index >= 0) {
      const thisTickerFunc = this.stageAnimations[index];
      this.currentApp?.ticker.remove(thisTickerFunc.animationObject.tickerFunc);
      thisTickerFunc.animationObject.setEndState();
      this.unlockStageObject(thisTickerFunc.targetKey ?? 'default');
      this.stageAnimations.splice(index, 1);
    }
  }

  public removeAnimationWithSetEffects(key: string) {
    const index = this.stageAnimations.findIndex((e) => e.key === key);
    if (index >= 0) {
      const thisTickerFunc = this.stageAnimations[index];
      this.currentApp?.ticker.remove(thisTickerFunc.animationObject.tickerFunc);
      thisTickerFunc.animationObject.setEndState();
      const webgalFilters = thisTickerFunc.animationObject.getEndFilterEffect?.() ?? {};
      this.unlockStageObject(thisTickerFunc.targetKey ?? 'default');
      if (thisTickerFunc.targetKey) {
        const target = this.getStageObjByKey(thisTickerFunc.targetKey);
        if (target) {
          const targetTransform = {
            alpha: target.pixiContainer.alphaFilterVal,
            scale: {
              x: target.pixiContainer.scale.x,
              y: target.pixiContainer.scale.y,
            },
            // pivot: {
            //   x: target.pixiContainer.pivot.x,
            //   y: target.pixiContainer.pivot.y,
            // },
            position: {
              x: target.pixiContainer.x,
              y: target.pixiContainer.y,
            },
            rotation: target.pixiContainer.rotation,
            // @ts-ignore
            blur: target.pixiContainer.blur,
            ...webgalFilters,
          };
          let effect: IEffect = {
            target: thisTickerFunc.targetKey,
            transform: targetTransform,
          };
          webgalStore.dispatch(stageActions.updateEffect(effect));
          // if (!this.notUpdateBacklogEffects) updateCurrentBacklogEffects(webgalStore.getState().stage.effects);
        }
      }
      this.stageAnimations.splice(index, 1);
    }
  }

  // eslint-disable-next-line max-params
  public performMouthSyncAnimation(
    key: string,
    targetAnimation: IFigureAssociatedAnimation,
    mouthState: string,
    presetPosition: string,
  ) {
    const currentFigure = this.getStageObjByKey(key)?.pixiContainer as WebGALPixiContainer;

    if (!currentFigure) {
      return;
    }

    const mouthTextureUrls: any = {
      open: targetAnimation.mouthAnimation.open,
      half_open: targetAnimation.mouthAnimation.halfOpen,
      closed: targetAnimation.mouthAnimation.close,
    };

    // Load mouth texture (reuse if already loaded)
    this.loadAsset(mouthTextureUrls[mouthState], () => {
      const texture = this.assetLoader.resources[mouthTextureUrls[mouthState]].texture;
      const sprite = currentFigure?.children?.[0] as PIXI.Sprite;
      if (!texture || !sprite) {
        return;
      }
      sprite.texture = texture;
    });
  }

  // eslint-disable-next-line max-params
  public performBlinkAnimation(
    key: string,
    targetAnimation: IFigureAssociatedAnimation,
    blinkState: string,
    presetPosition: string,
  ) {
    const currentFigure = this.getStageObjByKey(key)?.pixiContainer as WebGALPixiContainer;

    if (!currentFigure) {
      return;
    }
    const blinkTextureUrls: any = {
      open: targetAnimation.blinkAnimation.open,
      closed: targetAnimation.blinkAnimation.close,
    };

    // Load eye texture (reuse if already loaded)
    this.loadAsset(blinkTextureUrls[blinkState], () => {
      const texture = this.assetLoader.resources[blinkTextureUrls[blinkState]].texture;
      const sprite = currentFigure?.children?.[0] as PIXI.Sprite;
      if (!texture || !sprite) {
        return;
      }
      sprite.texture = texture;
    });
  }

  /**
   * 添加背景
   * @param key 背景的标识，一般和背景类型有关
   * @param url 背景图片url
   */
  public addBg(key: string, url: string) {
    // const loader = this.assetLoader;
    const loader = this.assetLoader;
    // 准备用于存放这个背景的 Container
    const thisBgContainer = new WebGALPixiContainer();

    // 是否有相同 key 的背景
    const setBgIndex = this.backgroundObjects.findIndex((e) => e.key === key);
    const isBgSet = setBgIndex >= 0;

    // 已经有一个这个 key 的背景存在了
    if (isBgSet) {
      // 挤占
      this.removeStageObjectByKey(key);
    }

    // 挂载
    this.backgroundContainer.addChild(thisBgContainer);
    const bgUuid = uuid();
    this.backgroundObjects.push({
      uuid: bgUuid,
      key: key,
      pixiContainer: thisBgContainer,
      sourceUrl: url,
      sourceType: 'img',
      sourceExt: this.getExtName(url),
    });

    // 完成图片加载后执行的函数
    const setup = () => {
      // TODO：找一个更好的解法，现在的解法是无论是否复用原来的资源，都设置一个延时以让动画工作正常！

      setTimeout(() => {
        const texture = loader.resources?.[url]?.texture;
        if (texture && this.getStageObjByUuid(bgUuid)) {
          /**
           * 重设大小
           */
          const originalWidth = texture.width;
          const originalHeight = texture.height;
          const scaleX = this.stageWidth / originalWidth;
          const scaleY = this.stageHeight / originalHeight;
          const targetScale = Math.max(scaleX, scaleY);
          const bgSprite = new PIXI.Sprite(texture);
          bgSprite.scale.x = targetScale;
          bgSprite.scale.y = targetScale;
          bgSprite.anchor.set(0.5);
          bgSprite.position.y = this.stageHeight / 2;
          thisBgContainer.setBaseX(this.stageWidth / 2);
          thisBgContainer.setBaseY(this.stageHeight / 2);
          thisBgContainer.pivot.set(0, this.stageHeight / 2);

          // 挂载
          thisBgContainer.addChild(bgSprite);
        }
      }, 0);
    };

    /**
     * 加载器部分
     */
    this.cacheGC();
    if (!loader.resources?.[url]?.texture) {
      this.loadAsset(url, setup);
    } else {
      // 复用
      setup();
    }
  }

  /**
   * 添加视频背景
   * @param key 背景的标识，一般和背景类型有关
   * @param url 背景图片url
   */
  public addVideoBg(key: string, url: string) {
    const loader = this.assetLoader;
    // 准备用于存放这个背景的 Container
    const thisBgContainer = new WebGALPixiContainer();

    // 是否有相同 key 的背景
    const setBgIndex = this.backgroundObjects.findIndex((e) => e.key === key);
    const isBgSet = setBgIndex >= 0;

    // 已经有一个这个 key 的背景存在了
    if (isBgSet) {
      // 挤占
      this.removeStageObjectByKey(key);
    }

    // 挂载
    this.backgroundContainer.addChild(thisBgContainer);
    const bgUuid = uuid();
    this.backgroundObjects.push({
      uuid: bgUuid,
      key: key,
      pixiContainer: thisBgContainer,
      sourceUrl: url,
      sourceType: 'video',
      sourceExt: this.getExtName(url),
    });

    // 完成加载后执行的函数
    const setup = () => {
      // TODO：找一个更好的解法，现在的解法是无论是否复用原来的资源，都设置一个延时以让动画工作正常！

      setTimeout(() => {
        console.debug('start loaded video: ' + url);
        const video = document.createElement('video');
        const videoResource = new PIXI.VideoResource(video);
        videoResource.src = url;
        videoResource.source.preload = 'auto';
        videoResource.source.muted = true;
        videoResource.source.loop = true;
        videoResource.source.autoplay = true;
        videoResource.source.src = url;
        // @ts-ignore
        const texture = PIXI.Texture.from(videoResource);
        if (texture && this.getStageObjByUuid(bgUuid)) {
          /**
           * 重设大小
           */
          texture.baseTexture.resource.load().then(() => {
            const originalWidth = videoResource.source.videoWidth;
            const originalHeight = videoResource.source.videoHeight;
            const scaleX = this.stageWidth / originalWidth;
            const scaleY = this.stageHeight / originalHeight;
            const targetScale = Math.max(scaleX, scaleY);
            const bgSprite = new PIXI.Sprite(texture);
            bgSprite.scale.x = targetScale;
            bgSprite.scale.y = targetScale;
            bgSprite.anchor.set(0.5);
            bgSprite.position.y = this.stageHeight / 2;
            thisBgContainer.setBaseX(this.stageWidth / 2);
            thisBgContainer.setBaseY(this.stageHeight / 2);
            thisBgContainer.pivot.set(0, this.stageHeight / 2);
            thisBgContainer.addChild(bgSprite);
          });
        }
      }, 0);
    };

    /**
     * 加载器部分
     */
    this.cacheGC();
    if (!loader.resources?.[url]?.texture) {
      this.loadAsset(url, setup);
    } else {
      // 复用
      setup();
    }
  }

  /**
   * 添加立绘
   * @param key 立绘的标识，一般和立绘位置有关
   * @param url 立绘图片url
   * @param presetPosition
   */
  public addFigure(key: string, url: string, presetPosition: 'left' | 'center' | 'right' = 'center') {
    const ext = this.getExtName(url).toLowerCase();
    // gif播放
    if (ext === 'gif') {
      this.addGifFigure(key, url, presetPosition);
      return;
    }
    const loader = this.assetLoader;
    // 准备用于存放这个立绘的 Container
    const thisFigureContainer = new WebGALPixiContainer();

    // 是否有相同 key 的立绘
    const setFigIndex = this.figureObjects.findIndex((e) => e.key === key);
    const isFigSet = setFigIndex >= 0;

    // 已经有一个这个 key 的立绘存在了
    if (isFigSet) {
      this.removeStageObjectByKey(key);
    }

    const metadata = this.getFigureMetadataByKey(key);
    if (metadata) {
      if (metadata.zIndex) {
        thisFigureContainer.zIndex = metadata.zIndex;
      }
    }
    // 挂载
    this.figureContainer.addChild(thisFigureContainer);
    const figureUuid = uuid();
    this.figureObjects.push({
      uuid: figureUuid,
      key: key,
      pixiContainer: thisFigureContainer,
      sourceUrl: url,
      sourceType: 'img',
      sourceExt: this.getExtName(url),
    });

    // 完成图片加载后执行的函数
    const setup = () => {
      // TODO：找一个更好的解法，现在的解法是无论是否复用原来的资源，都设置一个延时以让动画工作正常！
      setTimeout(() => {
        const texture = loader.resources?.[url]?.texture;
        if (texture && this.getStageObjByUuid(figureUuid)) {
          /**
           * 重设大小
           */
          const originalWidth = texture.width;
          const originalHeight = texture.height;
          const scaleX = this.stageWidth / originalWidth;
          const scaleY = this.stageHeight / originalHeight;
          const targetScale = Math.min(scaleX, scaleY);
          const figureSprite = new PIXI.Sprite(texture);
          figureSprite.scale.x = targetScale;
          figureSprite.scale.y = targetScale;
          figureSprite.anchor.set(0.5);
          figureSprite.position.y = this.stageHeight / 2;
          const targetWidth = originalWidth * targetScale;
          const targetHeight = originalHeight * targetScale;
          thisFigureContainer.setBaseY(this.stageHeight / 2);
          if (targetHeight < this.stageHeight) {
            thisFigureContainer.setBaseY(this.stageHeight / 2 + (this.stageHeight - targetHeight) / 2);
          }
          if (presetPosition === 'center') {
            thisFigureContainer.setBaseX(this.stageWidth / 2);
          }
          if (presetPosition === 'left') {
            thisFigureContainer.setBaseX(targetWidth / 2);
          }
          if (presetPosition === 'right') {
            thisFigureContainer.setBaseX(this.stageWidth - targetWidth / 2);
          }
          thisFigureContainer.pivot.set(0, this.stageHeight / 2);
          thisFigureContainer.addChild(figureSprite);
        }
      }, 0);
    };

    /**
     * 加载器部分
     */
    this.cacheGC();
    if (!loader.resources?.[url]?.texture) {
      this.loadAsset(url, setup);
    } else {
      // 复用
      setup();
    }
  }

  // 播放gif
  public async addGifFigure(key: string, url: string, presetPosition: 'left' | 'center' | 'right' = 'center') {
    const thisFigureContainer = new WebGALPixiContainer();

    // 移除已有相同 key 的立绘
    const existingIndex = this.figureObjects.findIndex((e) => e.key === key);
    if (existingIndex >= 0) {
      this.removeStageObjectByKey(key);
    }

    // 设置 zIndex（如果 metadata 有）
    const metadata = this.getFigureMetadataByKey(key);
    if (metadata?.zIndex !== undefined) {
      thisFigureContainer.zIndex = metadata.zIndex;
    }

    // 添加容器到舞台
    this.figureContainer.addChild(thisFigureContainer);

    // 注册到立绘对象列表
    const figureUuid = uuid();
    this.figureObjects.push({
      uuid: figureUuid,
      key,
      pixiContainer: thisFigureContainer,
      sourceUrl: url,
      sourceType: 'gif',
      sourceExt: 'gif',
    });

    try {
      // ✅ 使用 fetch 异步加载 buffer
      const buffer = await fetch(url).then((res) => res.arrayBuffer());

      // ✅ 使用 AnimatedGIF.fromBuffer 异步解码
      const gif = await AnimatedGIF.fromBuffer(buffer);

      const originalWidth = gif.width;
      const originalHeight = gif.height;
      const scaleX = this.stageWidth / originalWidth;
      const scaleY = this.stageHeight / originalHeight;
      const targetScale = Math.min(scaleX, scaleY);

      // 设置缩放、锚点、初始位置
      gif.scale.set(targetScale);
      gif.anchor.set(0.5);
      gif.position.y = this.stageHeight / 2;

      const targetWidth = originalWidth * targetScale;
      const targetHeight = originalHeight * targetScale;

      // Y 位置微调（让立绘整体居中）
      thisFigureContainer.setBaseY(this.stageHeight / 2);
      if (targetHeight < this.stageHeight) {
        thisFigureContainer.setBaseY(this.stageHeight / 2 + (this.stageHeight - targetHeight) / 2);
      }

      // 设置 X 方向位置
      if (presetPosition === 'center') {
        thisFigureContainer.setBaseX(this.stageWidth / 2);
      } else if (presetPosition === 'left') {
        thisFigureContainer.setBaseX(targetWidth / 2);
      } else if (presetPosition === 'right') {
        thisFigureContainer.setBaseX(this.stageWidth - targetWidth / 2);
      }

      thisFigureContainer.pivot.set(0, this.stageHeight / 2);

      // ✅ 播放动画 + 添加到容器
      gif.play();
      thisFigureContainer.addChild(gif);
    } catch (e) {
      console.error('GIF 加载失败', e);
    }
  }
  // 实现添加拼好模
  public async addJsonlFigure(key: string, jsonlPath: string, presetPosition: 'left' | 'center' | 'right' = 'center') {
    console.log('正在调用 addJsonlFigure');
    if (this.isLive2dAvailable !== true) return;

    try {
      const response = await fetch(jsonlPath);
      const jsonlText = await response.text();
      const lines = jsonlText.split('\n').filter(Boolean);

      const paths: string[] = [];
      const jsonlBaseDir = jsonlPath.substring(0, jsonlPath.lastIndexOf('/') + 1);

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj?.path) {
            let fullPath = obj.path;

            // 如果是相对路径，则补全
            if (!obj.path.startsWith('game/')) {
              // 例如 jsonlPath = 'game/figure/该溜子祥子/该溜子祥子.jsonl'
              // 则 jsonlBaseDir = 'game/figure/该溜子祥子/'
              fullPath = jsonlBaseDir + obj.path.replace(/^\.\//, '');
            }

            paths.push(fullPath);
          }
        } catch (e) {
          console.warn('JSONL parse error in line:', line);
        }
      }

      if (paths.length === 0) {
        console.warn('No valid paths in jsonl:', jsonlPath);
        return;
      }

      const container = new WebGALPixiContainer();
      container.alpha = 0; // 👈 初始透明
      const figureUuid = uuid();

      // 清除已有 key
      const index = this.figureObjects.findIndex((e) => e.key === key);
      if (index >= 0) {
        this.removeStageObjectByKey(key);
      }

      const metadata = this.getFigureMetadataByKey(key);
      if (metadata?.zIndex) container.zIndex = metadata.zIndex;

      this.figureContainer.addChild(container);
      this.figureObjects.push({
        uuid: figureUuid,
        key,
        pixiContainer: container,
        sourceUrl: jsonlPath,
        sourceExt: 'jsonl',
        sourceType: 'live2d',
      });

      // 从状态读取 motion / expression（同 addLive2dFigure）
      const motionFromState = webgalStore.getState().stage.live2dMotion.find((e) => e.target === key);
      const expressionFromState = webgalStore.getState().stage.live2dExpression.find((e) => e.target === key);
      const motionToSet = motionFromState?.motion ?? '';
      const expressionToSet = expressionFromState?.expression ?? '';

      const models: any[] = [];

      // 加载模型并添加到 container 中
// 👇 使用 Promise.all 同步等待所有模型加载完成
      const modelPromises = paths.map((modelPath) => this.live2DModel.from(modelPath, { autoInteract: false }));

      const loadedModels = await Promise.all(modelPromises);
      const stageWidth = this.stageWidth;
      const stageHeight = this.stageHeight;

      for (const model of loadedModels) {
        if (!model) continue;

        const scaleX = stageWidth / model.width;
        const scaleY = stageHeight / model.height;
        const targetScale = Math.min(scaleX, scaleY);
        const targetWidth = model.width * targetScale;
        const targetHeight = model.height * targetScale;

        model.scale.set(targetScale);
        model.anchor.set(0.5);
        model.position.set(0, stageHeight / 2);

        container.setBaseY(stageHeight / 2);
        if (targetHeight < stageHeight) {
          container.setBaseY(stageHeight / 2 + (stageHeight - targetHeight) / 2);
        }

        if (presetPosition === 'center') {
          container.setBaseX(stageWidth / 2);
        } else if (presetPosition === 'left') {
          container.setBaseX(targetWidth / 2);
        } else if (presetPosition === 'right') {
          container.setBaseX(stageWidth - targetWidth / 2);
        }

        container.pivot.set(0, stageHeight / 2);

        models.push(model);
        container.addChild(model);
      }
      // 👇 所有模型加载完后统一设置 motion / expression
      for (const model of models) {
        if (motionToSet) {
          // @ts-ignore
          model.motion(motionToSet, 0, 3);
        }
        if (expressionToSet) {
          // @ts-ignore
          model.expression(expressionToSet);
        }

        // @ts-ignore 防止自带眨眼
        if (model.internalModel?.eyeBlink) {
          model.internalModel.eyeBlink.blinkInterval = 1000 * 60 * 60 * 24;
          model.internalModel.eyeBlink.nextBlinkTimeLeft = 1000 * 60 * 60 * 24;
        }
      }

      // 👇 更新状态记录（只更新一次）
      if (motionToSet) this.updateL2dMotionByKey(key, motionToSet);
      if (expressionToSet) this.updateL2dExpressionByKey(key, expressionToSet);

      // 👇 延迟 0.1 秒后显示容器
      setTimeout(() => {
        container.alpha = 1;
      }, 100);
    } catch (e) {
      console.error('addJsonlFigure 加载失败:', e);
    }
  }

  /**
   * Live2d立绘，如果要使用 Live2D，取消这里的注释
   * @param jsonPath
   */
  // eslint-disable-next-line max-params
  public addLive2dFigure(key: string, jsonPath: string, pos: string, motion: string, expression: string) {
    if (this.isLive2dAvailable !== true) return;
    try {
      let stageWidth = this.stageWidth;
      let stageHeight = this.stageHeight;
      logger.debug('Using motion:', motion);

      this.figureCash.push(jsonPath);

      const loader = this.assetLoader;
      // 准备用于存放这个立绘的 Container
      const thisFigureContainer = new WebGALPixiContainer();

      // 是否有相同 key 的立绘
      const setFigIndex = this.figureObjects.findIndex((e) => e.key === key);
      const isFigSet = setFigIndex >= 0;

      // 已经有一个这个 key 的立绘存在了
      if (isFigSet) {
        this.removeStageObjectByKey(key);
      }

      const metadata = this.getFigureMetadataByKey(key);
      if (metadata) {
        if (metadata.zIndex) {
          thisFigureContainer.zIndex = metadata.zIndex;
        }
      }
      // 挂载
      this.figureContainer.addChild(thisFigureContainer);
      const figureUuid = uuid();
      this.figureObjects.push({
        uuid: figureUuid,
        key: key,
        pixiContainer: thisFigureContainer,
        sourceUrl: jsonPath,
        sourceType: 'live2d',
        sourceExt: 'json',
      });
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const instance = this;

      const setup = (stage: PixiStage) => {
        if (thisFigureContainer && this.getStageObjByUuid(figureUuid)) {
          (async function () {
            let overrideBounds: [number, number, number, number] = [0, 0, 0, 0];
            const mot = webgalStore.getState().stage.live2dMotion.find((e) => e.target === key);
            if (mot?.overrideBounds) {
              overrideBounds = mot.overrideBounds;
            }
            console.log(overrideBounds);
            const models = await Promise.all([
              stage.live2DModel.from(jsonPath, {
                autoInteract: false,
                overWriteBounds: {
                  x0: overrideBounds[0],
                  y0: overrideBounds[1],
                  x1: overrideBounds[2],
                  y1: overrideBounds[3],
                },
              }),
            ]);

            models.forEach((model) => {
              const scaleX = stageWidth / model.width;
              const scaleY = stageHeight / model.height;
              const targetScale = Math.min(scaleX, scaleY);
              const targetWidth = model.width * targetScale;
              const targetHeight = model.height * targetScale;
              model.scale.x = targetScale;
              model.scale.y = targetScale;
              model.anchor.set(0.5);
              model.pivot.x += (overrideBounds[0] + overrideBounds[2]) * 0.5;
              model.pivot.y += (overrideBounds[1] + overrideBounds[3]) * 0.5;
              model.position.x = 0;
              model.position.y = stageHeight / 2;

              let baseY = stageHeight / 2;
              if (targetHeight < stageHeight) {
                baseY = stageHeight / 2 + (stageHeight - targetHeight) / 2;
              }
              thisFigureContainer.setBaseY(baseY);
              if (pos === 'center') {
                thisFigureContainer.setBaseX(stageWidth / 2);
              } else if (pos === 'left') {
                thisFigureContainer.setBaseX(targetWidth / 2);
              } else if (pos === 'right') {
                thisFigureContainer.setBaseX(stageWidth - targetWidth / 2);
              }

              thisFigureContainer.pivot.set(0, stageHeight / 2);
              let motionToSet = motion;
              let animation_index = 0;
              let priority_number = 3;
              // var audio_link = voiceCash.pop();

              // model.motion(category_name, animation_index, priority_number,location.href + audio_link);
              /**
               * 检查 Motion 和 Expression
               */
              const motionFromState = webgalStore.getState().stage.live2dMotion.find((e) => e.target === key);
              const expressionFromState = webgalStore.getState().stage.live2dExpression.find((e) => e.target === key);
              if (motionFromState) {
                motionToSet = motionFromState.motion;
              }
              instance.updateL2dMotionByKey(key, motionToSet);
              model.motion(motionToSet, animation_index, priority_number);
              let expressionToSet = expression;
              if (expressionFromState) {
                expressionToSet = expressionFromState.expression;
              }
              instance.updateL2dExpressionByKey(key, expressionToSet);
              model.expression(expressionToSet);
              // @ts-ignore
              if (model.internalModel.eyeBlink) {
                // @ts-ignore
                model.internalModel.eyeBlink.blinkInterval = 1000 * 60 * 60 * 24; // @ts-ignore
                model.internalModel.eyeBlink.nextBlinkTimeLeft = 1000 * 60 * 60 * 24;
              }

              // lip-sync is still a problem and you can not.
              stage.soundManager.volume = 0; // @ts-ignore
              if (model.internalModel.angleXParamIndex !== undefined) model.internalModel.angleXParamIndex = 999; // @ts-ignore
              if (model.internalModel.angleYParamIndex !== undefined) model.internalModel.angleYParamIndex = 999; // @ts-ignore
              if (model.internalModel.angleZParamIndex !== undefined) model.internalModel.angleZParamIndex = 999;
              thisFigureContainer.addChild(model);
            });
          })();
        }
      };

      /**
       * 加载器部分
       */
      const resourses = Object.keys(loader.resources);
      this.cacheGC();
      if (!resourses.includes(jsonPath)) {
        this.loadAsset(jsonPath, () => setup(this));
      } else {
        // 复用
        setup(this);
      }
    } catch (error) {
      console.error('Live2d Module err: ' + error);
      this.isLive2dAvailable = false;
    }
  }

  public changeModelMotionByKey(key: string, motion: string) {
    // logger.debug(`Applying motion ${motion} to ${key}`);
    const target = this.figureObjects.find((e) => e.key === key);
    if (target?.sourceType === 'live2d') {
      const figureRecordTarget = this.live2dFigureRecorder.find((e) => e.target === key);
      if (target && figureRecordTarget?.motion !== motion) {
        const container = target.pixiContainer;
        const children = container.children;
        for (const model of children) {
          let category_name = motion;
          let animation_index = 0;
          let priority_number = 3; // @ts-ignore
          const internalModel = model?.internalModel ?? undefined; // 安全访问
          internalModel?.motionManager?.stopAllMotions?.();
          // @ts-ignore
          model.motion(category_name, animation_index, priority_number);
        }
        this.updateL2dMotionByKey(key, motion);
      }
    } else if (target?.sourceType === 'spine') {
      // 处理 Spine 动画切换
      this.changeSpineAnimationByKey(key, motion);
    }
  }

  public changeSpineAnimationByKey(key: string, animation: string) {
    const target = this.figureObjects.find((e) => e.key === key);
    if (target?.sourceType !== 'spine') return;

    const container = target.pixiContainer;
    // Spine figure 结构: Container -> Sprite -> Spine
    const sprite = container.children[0] as PIXI.Container;
    if (sprite?.children?.[0]) {
      const spineObject = sprite.children[0];
      // @ts-ignore
      if (spineObject.state && spineObject.spineData) {
        // @ts-ignore
        const animationExists = spineObject.spineData.animations.find((anim: any) => anim.name === animation);
        let targetCurrentAnimation = target?.spineAnimation ?? '';
        if (animationExists && targetCurrentAnimation !== animation) {
          console.log(`setting animation ${animation}`);
          target!.spineAnimation = animation;
          // @ts-ignore
          spineObject.state.setAnimation(0, animation, false);
        }
      }
    }
  }

  public changeModelExpressionByKey(key: string, expression: string) {
    // logger.debug(`Applying expression ${expression} to ${key}`);
    const target = this.figureObjects.find((e) => e.key === key);
    if (target?.sourceType !== 'live2d') return;
    const figureRecordTarget = this.live2dFigureRecorder.find((e) => e.target === key);
    if (target && figureRecordTarget?.expression !== expression) {
      const container = target.pixiContainer;
      const children = container.children;
      for (const model of children) {
        // @ts-ignore
        model.expression(expression);
      }
      this.updateL2dExpressionByKey(key, expression);
    }
  }

  public setModelMouthY(key: string, y: number) {
    function mapToZeroOne(value: number) {
      return value < 50 ? 0 : (value - 50) / 50;
    }

    const paramY = mapToZeroOne(y);
    const target = this.figureObjects.find((e) => e.key === key);
    if (target && target.sourceType === 'live2d') {
      const container = target.pixiContainer;
      const children = container.children;
      for (const model of children) {
        // @ts-ignore
        if (model?.internalModel) {
          // @ts-ignore
          if (model?.internalModel?.coreModel?.setParamFloat)
            // @ts-ignore
            model?.internalModel?.coreModel?.setParamFloat?.('PARAM_MOUTH_OPEN_Y', paramY);
          // @ts-ignore
          if (model?.internalModel?.coreModel?.setParameterValueById)
            // @ts-ignore
            model?.internalModel?.coreModel?.setParameterValueById('ParamMouthOpenY', paramY);
        }
      }
    }
  }

  /**
   * 根据 key 获取舞台上的对象
   * @param key
   */
  public getStageObjByKey(key: string) {
    return [...this.figureObjects, ...this.backgroundObjects].find((e) => e.key === key);
  }

  public getStageObjByUuid(objUuid: string) {
    return [...this.figureObjects, ...this.backgroundObjects].find((e) => e.uuid === objUuid);
  }

  public getAllStageObj() {
    return [...this.figureObjects, ...this.backgroundObjects];
  }

  /**
   * 根据 key 删除舞台上的对象
   * @param key
   */
  public removeStageObjectByKey(key: string) {
    const indexFig = this.figureObjects.findIndex((e) => e.key === key);
    const indexBg = this.backgroundObjects.findIndex((e) => e.key === key);
    if (indexFig >= 0) {
      const bgSprite = this.figureObjects[indexFig];
      for (const element of bgSprite.pixiContainer.children) {
        element.destroy();
      }
      bgSprite.pixiContainer.destroy();
      this.figureContainer.removeChild(bgSprite.pixiContainer);
      this.figureObjects.splice(indexFig, 1);
    }
    if (indexBg >= 0) {
      const bgSprite = this.backgroundObjects[indexBg];
      for (const element of bgSprite.pixiContainer.children) {
        element.destroy();
      }
      bgSprite.pixiContainer.destroy();
      this.backgroundContainer.removeChild(bgSprite.pixiContainer);
      this.backgroundObjects.splice(indexBg, 1);
    }
    // /**
    //  * 删掉相关 Effects，因为已经移除了
    //  */
    // const prevEffects = webgalStore.getState().stage.effects;
    // const newEffects = __.cloneDeep(prevEffects);
    // const index = newEffects.findIndex((e) => e.target === key);
    // if (index >= 0) {
    //   newEffects.splice(index, 1);
    // }
    // updateCurrentEffects(newEffects);
  }

  public cacheGC() {
    PIXI.utils.clearTextureCache();
  }

  public getExtName(url: string) {
    return url.split('.').pop() ?? 'png';
  }

  public getFigureMetadataByKey(key: string): IFigureMetadata | undefined {
    console.log(key, webgalStore.getState().stage.figureMetaData);
    return webgalStore.getState().stage.figureMetaData[key];
  }

  public loadAsset(url: string, callback: () => void, name?: string) {
    /**
     * Loader 复用疑似有问题，转而采用先前的单独方式
     */
    this.loadQueue.unshift({ url, callback, name });
    /**
     * 尝试启动加载
     */
    this.callLoader();
  }

  private updateL2dMotionByKey(target: string, motion: string) {
    const figureTargetIndex = this.live2dFigureRecorder.findIndex((e) => e.target === target);
    if (figureTargetIndex >= 0) {
      this.live2dFigureRecorder[figureTargetIndex].motion = motion;
    } else {
      this.live2dFigureRecorder.push({ target, motion, expression: '' });
    }
  }

  private updateL2dExpressionByKey(target: string, expression: string) {
    const figureTargetIndex = this.live2dFigureRecorder.findIndex((e) => e.target === target);
    if (figureTargetIndex >= 0) {
      this.live2dFigureRecorder[figureTargetIndex].expression = expression;
    } else {
      this.live2dFigureRecorder.push({ target, motion: '', expression });
    }
  }

  private callLoader() {
    if (!this.assetLoader.loading) {
      const front = this.loadQueue.shift();
      if (front) {
        try {
          if (this.assetLoader.resources[front.url]) {
            front.callback();
            this.callLoader();
          } else {
            if (front.name) {
              this.assetLoader.add(front.name, front.url).load(() => {
                front.callback();
                this.callLoader();
              });
            } else {
              this.assetLoader.add(front.url).load(() => {
                front.callback();
                this.callLoader();
              });
            }
          }
        } catch (error) {
          logger.fatal('PIXI Loader 故障', error);
          front.callback();
          // this.assetLoader.reset(); // 暂时先不用重置
          this.callLoader();
        }
      }
    }
  }

  private updateFps() {
    getScreenFps?.(120).then((fps) => {
      this.frameDuration = 1000 / (fps as number);
      // logger.info('当前帧率', fps);
    });
  }

  private lockStageObject(targetName: string) {
    this.lockTransformTarget.push(targetName);
  }

  private unlockStageObject(targetName: string) {
    const index = this.lockTransformTarget.findIndex((name) => name === targetName);
    if (index >= 0) this.lockTransformTarget.splice(index, 1);
  }

  private async initialize() {
    // 动态加载 figureCash
    try {
      const { figureCash } = await import('@/Core/gameScripts/vocal/conentsCash');
      this.figureCash = figureCash;
      const { Live2DModel, SoundManager } = await import('pixi-live2d-display-webgal');
      this.live2DModel = Live2DModel;
      this.soundManager = SoundManager;
    } catch (error) {
      this.isLive2dAvailable = false;
      console.info('live2d lib load failed', error);
    }
    if (this.isLive2dAvailable === undefined) {
      this.isLive2dAvailable = true;
      console.info('live2d lib load success');
    }
  }
}

function updateCurrentBacklogEffects(newEffects: IEffect[]) {
  /**
   * 更新当前 backlog 条目的 effects 记录
   */
  setTimeout(() => {
    WebGAL.backlogManager.editLastBacklogItemEffect(cloneDeep(newEffects));
  }, 50);

  webgalStore.dispatch(setStage({ key: 'effects', value: newEffects }));
}

/**
 * @param {number} targetCount 不小于1的整数，表示经过targetCount帧之后返回结果
 * @return {Promise<number>}
 */
const getScreenFps = (() => {
  // 先做一下兼容性处理
  const nextFrame = [
    window.requestAnimationFrame,
    // @ts-ignore
    window.webkitRequestAnimationFrame,
    // @ts-ignore
    window.mozRequestAnimationFrame,
  ].find((fn) => fn);
  if (!nextFrame) {
    console.error('requestAnimationFrame is not supported!');
    return;
  }
  return (targetCount = 60) => {
    // 判断参数是否合规
    if (targetCount < 1) throw new Error('targetCount cannot be less than 1.');
    const beginDate = Date.now();
    let count = 0;
    return new Promise((resolve) => {
      (function log() {
        nextFrame(() => {
          if (++count >= targetCount) {
            const diffDate = Date.now() - beginDate;
            const fps = (count / diffDate) * 1000;
            return resolve(fps);
          }
          log();
        });
      })();
    });
  };
})();
