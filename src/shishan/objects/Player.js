/**
 * 小诗童玩家角色。
 * 使用 Arcade Physics，底部贴地，带走路两帧动画与脚下淡影。
 */

export class Player {
  constructor(scene, x, y) {
    this.scene = scene;
    this.speed = 235;
    this.moving = false;

    this.shadow = scene.add
      .ellipse(x, y - 2, 54, 16, 0x46543b, 0.16)
      .setDepth(y - 2);

    this.sprite = scene.physics.add
      .sprite(x, y, 'poem_boy_idle')
      .setOrigin(0.5, 1)
      .setDepth(y);

    // 碰撞体只覆盖脚部，避免头和树冠“隔空撞到”
    this.sprite.body.setSize(34, 22);
    this.sprite.body.setOffset(33, 94);
    this.sprite.setCollideWorldBounds(true);
    this.sprite.setDamping(true);
    this.sprite.setDrag(0.001, 0.001);

    this.sprite.anims.play('poem_boy_walk');
    this.sprite.anims.stop();
    this.sprite.setTexture('poem_boy_idle');
  }

  /**
   * @param {{x:number,y:number}} vector 归一化方向
   * @param {number} delta 毫秒
   */
  update(vector, delta) {
    const length = Math.hypot(vector.x, vector.y);
    const moving = length > 0.08;

    if (moving) {
      const nx = vector.x / Math.max(1, length);
      const ny = vector.y / Math.max(1, length);
      const speed = this.speed * Math.min(1, length);
      this.sprite.setVelocity(nx * speed, ny * speed);

      if (nx < -0.12) this.sprite.setFlipX(true);
      else if (nx > 0.12) this.sprite.setFlipX(false);

      if (this.sprite.anims.currentAnim?.key !== 'poem_boy_walk') {
        this.sprite.anims.play('poem_boy_walk', true);
      }
    } else {
      this.sprite.setVelocity(0, 0);
      if (this.sprite.anims.isPlaying) {
        this.sprite.anims.stop();
        this.sprite.setTexture('poem_boy_idle');
      }
    }

    this.moving = moving;
    this.sprite.setDepth(this.sprite.y);
    this.shadow.setPosition(this.sprite.x, this.sprite.y - 2);
    this.shadow.setDepth(this.sprite.y - 2);
    const pulse = moving ? 1 + Math.sin(this.scene.time.now * 0.014) * 0.06 : 1;
    this.shadow.setScale(pulse, 1);
  }

  stop() {
    this.sprite.setVelocity(0, 0);
    if (this.sprite.anims.isPlaying) {
      this.sprite.anims.stop();
      this.sprite.setTexture('poem_boy_idle');
    }
    this.moving = false;
  }

  get x() {
    return this.sprite.x;
  }

  get y() {
    return this.sprite.y;
  }

  getPosition() {
    return { x: this.sprite.x, y: this.sprite.y };
  }

  setPosition(x, y) {
    this.sprite.setPosition(x, y);
    this.shadow.setPosition(x, y - 2);
  }

  destroy() {
    this.sprite.destroy();
    this.shadow.destroy();
  }
}
