(function() {
// Space Mission - Educational Game using Phaser 3
class SpaceMission extends Phaser.Scene {
    constructor() {
        super('SpaceMission');
        this.player = null;
        this.stars = null;
        this.dust = null;
        this.bgPlanets = null;
        this.obstacles = null;
        this.energyCells = null;
        this.nebula = null;
        this.particles = null;
        this.gameStarted = false;
        this.speed = 3;
        this.distance = 0;
        this.isQuizActive = false;
        this.nextQuestionDistance = 1000;
        this.score = 0;
        this.hasShield = false;
        this.shieldGraphic = null;
    }

    preload() {}

    create() {
        const { width, height } = this.sys.game.config;

        // 1. Layers & Parallax
        this.createStarfield(width, height);
        this.bgPlanets = this.add.group();
        this.createNebula(width, height);

        // 2. Player
        this.createPlayer(width, height);

        // 3. Gameplay Groups
        this.obstacles = this.physics.add.group();
        this.energyCells = this.physics.add.group();
        
        // 4. Effects
        this.createParticles();

        // 5. Physics
        this.physics.add.overlap(this.player, this.obstacles, this.hitObstacle, null, this);
        this.physics.add.overlap(this.player, this.energyCells, this.collectEnergy, null, this);

        // 6. Controls
        this.input.on('pointermove', (pointer) => {
            if (this.gameStarted && !this.isQuizActive) {
                this.tweens.add({
                    targets: this.player,
                    x: Phaser.Math.Clamp(pointer.x, 50, width - 50),
                    duration: 100,
                    ease: 'Power1'
                });
            }
        });
    }

    createStarfield(width, height) {
        this.stars = this.add.group();
        for (let i = 0; i < 150; i++) {
            const x = Phaser.Math.Between(0, width);
            const y = Phaser.Math.Between(0, height);
            const size = Phaser.Math.FloatBetween(0.5, 1.5);
            const star = this.add.circle(x, y, size, 0xffffff, Phaser.Math.FloatBetween(0.2, 0.8));
            this.stars.add(star);
        }

        this.dust = this.add.group();
        for (let i = 0; i < 40; i++) {
            const x = Phaser.Math.Between(0, width);
            const y = Phaser.Math.Between(0, height);
            const d = this.add.rectangle(x, y, 2, 15, 0xffffff, 0.1);
            this.dust.add(d);
        }
    }

    spawnBGPlanet() {
        const { width } = this.sys.game.config;
        const x = Phaser.Math.Between(0, width);
        const size = Phaser.Math.Between(80, 200);
        const color = Phaser.Utils.Array.GetRandom([0x455a64, 0x1a237e, 0x3e2723, 0xbf360c, 0x006064]);
        
        const planetContainer = this.add.container(x, -300);
        const planet = this.add.circle(0, 0, size, color);
        planet.setAlpha(0.4);
        
        for (let i = 0; i < 5; i++) {
            const spot = this.add.circle(
                Phaser.Math.Between(-size/2, size/2),
                Phaser.Math.Between(-size/2, size/2),
                Phaser.Math.Between(10, size/4),
                0x000000, 0.1
            );
            planetContainer.add(spot);
        }

        if (Math.random() > 0.7) {
            const ring = this.add.ellipse(0, 0, size * 2.5, size * 0.4);
            ring.setStrokeStyle(4, 0xffffff, 0.2);
            planetContainer.add(ring);
        }

        planetContainer.addAt(planet, 0);
        this.bgPlanets.add(planetContainer);
        planetContainer.setDepth(-1); 
    }

    createNebula(width, height) {
        const graphics = this.add.graphics();
        graphics.fillGradientStyle(0x050b18, 0x050b18, 0x1a237e, 0x1a237e, 0.5);
        graphics.fillRect(0, 0, width, height);
    }

    createPlayer(width, height) {
        const container = this.add.container(width / 2, height + 100);
        
        const engineGlow = this.add.circle(0, 25, 15, 0x00e5ff, 0.4);
        this.tweens.add({ targets: engineGlow, scale: 1.5, alpha: 0.1, duration: 500, repeat: -1, yoyo: true });

        const wingL = this.add.polygon(-18, 15, [0, 0, -12, 25, 12, 25], 0x455a64);
        const wingR = this.add.polygon(18, 15, [0, 0, 12, 25, -12, 25], 0x455a64);
        const body = this.add.ellipse(0, 0, 36, 75, 0xc0c0c0);
        const bodyShade = this.add.ellipse(-5, 0, 20, 65, 0xffffff, 0.2); 
        const nose = this.add.triangle(0, -38, -18, 0, 18, 0, 0, -25, 0xff5252);
        const windowFrame = this.add.circle(0, -10, 11, 0x37474f);
        const windowGlass = this.add.circle(0, -10, 8, 0x00b0ff);
        const windowShine = this.add.circle(-2, -12, 3, 0xffffff, 0.5);
        
        this.shieldGraphic = this.add.circle(0, 0, 60, 0x00e5ff, 0.2);
        this.shieldGraphic.setStrokeStyle(3, 0x00e5ff, 0.5);
        this.shieldGraphic.setVisible(false);

        container.add([engineGlow, wingL, wingR, body, bodyShade, nose, windowFrame, windowGlass, windowShine, this.shieldGraphic]);
        this.player = container;
        
        this.physics.world.enable(this.player);
        this.player.body.setSize(50, 80);
        this.player.body.setOffset(-25, -40);

        this.tweens.add({ targets: this.player, y: height * 0.75, duration: 2000, ease: 'Back.easeOut' });
    }

    createParticles() {
        const graphics = this.add.graphics();
        graphics.fillStyle(0xffab40, 1).fillCircle(4, 4, 4).generateTexture('flame', 8, 8).destroy();
        this.particles = this.add.particles(0, 30, 'flame', {
            speed: { min: 80, max: 200 },
            angle: { min: 85, max: 95 },
            scale: { start: 1.2, end: 0 },
            blendMode: 'ADD',
            lifespan: 600,
            frequency: 40
        });
        this.player.add(this.particles);
    }

    activateShield() {
        this.hasShield = true;
        this.shieldGraphic.setVisible(true);
        this.shieldGraphic.alpha = 0.5;
        this.tweens.add({
            targets: this.shieldGraphic,
            scale: { from: 0.9, to: 1.1 },
            duration: 800,
            yoyo: true,
            repeat: -1
        });
    }

    spawnObstacle() {
        if (!this.gameStarted || this.isQuizActive) return;
        const x = Phaser.Math.Between(50, this.sys.game.config.width - 50);
        const size = Phaser.Math.Between(25, 55);
        const points = [];
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const dist = size * Phaser.Math.FloatBetween(0.7, 1);
            points.push({ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist });
        }
        const obsContainer = this.add.container(x, -100);
        const rock = this.add.polygon(0, 0, points, 0x546e7a).setStrokeStyle(2, 0x37474f);
        for (let i = 0; i < 3; i++) {
            obsContainer.add(this.add.circle(Phaser.Math.Between(-size/3, size/3), Phaser.Math.Between(-size/3, size/3), Phaser.Math.Between(3, 8), 0x37474f, 0.4));
        }
        obsContainer.addAt(rock, 0);
        this.obstacles.add(obsContainer);
        this.physics.world.enable(obsContainer);
        obsContainer.body.setVelocityY(this.speed * 65);
        obsContainer.body.setAngularVelocity(Phaser.Math.Between(-100, 100));
    }

    spawnEnergy() {
        if (!this.gameStarted || this.isQuizActive) return;
        const x = Phaser.Math.Between(50, this.sys.game.config.width - 50);
        const energyContainer = this.add.container(x, -100);
        const glow = this.add.circle(0, 0, 25, 0x00e5ff, 0.3);
        const crystal = this.add.polygon(0, 0, [0, -20, 15, 0, 0, 20, -15, 0], 0x00e5ff).setStrokeStyle(2, 0xffffff);
        this.tweens.add({ targets: glow, scale: 2, alpha: 0, duration: 800, repeat: -1 });
        energyContainer.add([glow, crystal]);
        this.energyCells.add(energyContainer);
        this.physics.world.enable(energyContainer);
        energyContainer.body.setVelocityY(this.speed * 55);
        this.tweens.add({ targets: crystal, scaleX: 0.5, duration: 600, yoyo: true, repeat: -1 });
    }

    hitObstacle(player, obstacle) {
        obstacle.destroy();
        if (this.hasShield) {
            this.hasShield = false;
            this.shieldGraphic.setVisible(false);
            this.cameras.main.flash(200, 0, 229, 255, 0.3);
            return;
        }
        this.cameras.main.shake(200, 0.01);
        this.cameras.main.flash(200, 255, 0, 0, 0.2);
        this.score = Math.max(0, this.score - 50);
        GameApp.updateHUD(this.score, this.distance);
        this.tweens.add({ targets: this.player, alpha: 0.5, duration: 100, yoyo: true, repeat: 3 });
    }

    collectEnergy(player, energy) {
        energy.destroy();
        this.score += 20;
        GameApp.updateHUD(this.score, this.distance);
        this.cameras.main.flash(100, 255, 255, 255, 0.1);
        const originalSpeed = this.speed;
        this.speed += 1;
        this.time.delayedCall(500, () => { this.speed = originalSpeed; });
    }

    update() {
        if (!this.gameStarted) return;
        if (!this.isQuizActive) this.speed = 3 + (this.distance / 10000); 

        this.stars.children.iterate(s => { s.y += (this.speed * 0.5) * s.radius; if (s.y > this.sys.game.config.height) { s.y = 0; s.x = Phaser.Math.Between(0, this.sys.game.config.width); }});
        this.dust.children.iterate(d => { d.y += this.speed * 4; if (d.y > this.sys.game.config.height) { d.y = -20; d.x = Phaser.Math.Between(0, this.sys.game.config.width); }});
        this.bgPlanets.children.iterate(p => { if (p) { p.y += this.speed * 0.2; if (p.y > this.sys.game.config.height + 400) p.destroy(); }});

        if (!this.isQuizActive) {
            this.distance += this.speed;
            GameApp.updateHUD(this.score, this.distance);
            this.obstacles.children.iterate(o => { if (o && o.y > this.sys.game.config.height + 100) o.destroy(); });
            this.energyCells.children.iterate(e => { if (e && e.y > this.sys.game.config.height + 100) e.destroy(); });

            if (Phaser.Math.Between(0, 1000) < 5) this.spawnBGPlanet();
            if (Phaser.Math.Between(0, 100) < (2 + this.speed/10)) this.spawnObstacle();
            if (Phaser.Math.Between(0, 100) < 1) this.spawnEnergy();
            if (this.distance >= this.nextQuestionDistance) this.triggerQuestion();
        }
    }

    triggerQuestion() {
        this.isQuizActive = true;
        this.physics.pause();
        this.tweens.add({ targets: this, speed: 0, duration: 1000, onComplete: () => GameApp.renderQuestion() });
    }

    resumeFlight(correct) {
        this.isQuizActive = false;
        this.physics.resume();
        this.nextQuestionDistance += 1500;
        if (correct) { this.activateShield(); this.boost(); }
        else { this.speed = 3; }
    }

    boost() {
        this.tweens.add({
            targets: this, speed: 15, duration: 500,
            onComplete: () => {
                this.particles.setFrequency(10);
                this.time.delayedCall(2000, () => {
                    this.tweens.add({ targets: this, speed: 4, duration: 1000, onComplete: () => this.particles.setFrequency(40) });
                });
            }
        });
    }

    shake() { this.cameras.main.shake(300, 0.01); }
}

const GameApp = {
    config: {
        type: Phaser.AUTO, parent: 'phaser-game', width: window.innerWidth, height: window.innerHeight,
        transparent: true, scene: SpaceMission, physics: { default: 'arcade', arcade: { debug: false } }
    },
    instance: null, quizzes: [], currentQuiz: null, currentQuestionIndex: 0, score: 0, correctCount: 0,

    async init() {
        this.instance = new Phaser.Game(this.config);
        this.setupUI();
        await this.loadQuizzes();
    },

    setupUI() {
        document.getElementById('start-btn').onclick = () => this.startGame();
        document.getElementById('restart-btn').onclick = () => this.startGame();
        document.getElementById('quizSelect').onchange = (e) => {
            this.currentQuiz = this.quizzes.find(q => q.id == e.target.value);
            document.getElementById('start-btn').disabled = !this.currentQuiz;
        };
        window.onresize = () => { if (this.instance) this.instance.scale.resize(window.innerWidth, window.innerHeight); };
    },

    updateHUD(score, distance) {
        const s = document.getElementById('live-score'), d = document.getElementById('live-dist');
        if (s) s.textContent = Math.floor(score);
        if (d) d.textContent = `${Math.floor(distance / 10)}m`;
    },

    async loadQuizzes() {
        try {
            let q = [];
            if (window.api && (window.api.loadQuizzes || window.api.getQuizzes)) q = await (window.api.loadQuizzes || window.api.getQuizzes)() || [];
            else q = JSON.parse(localStorage.getItem('cm_quizzes_v1') || '[]');
            if (!Array.isArray(q)) q = Object.values(q);
            this.quizzes = q.filter(x => x.questions && x.questions.length > 0);
            const sel = document.getElementById('quizSelect');
            sel.innerHTML = this.quizzes.length ? '<option value="">-- اختر موضوعاً --</option>' : '<option value="">لا توجد اختبارات جاهزة</option>';
            this.quizzes.forEach(x => { const o = document.createElement('option'); o.value = x.id; o.textContent = x.title || x.name || 'اختبار'; sel.appendChild(o); });
        } catch (e) { console.error(e); }
    },

    startGame() {
        this.currentQuestionIndex = 0; this.score = 0; this.correctCount = 0;
        this.showScreen('quiz-overlay'); document.getElementById('quiz-overlay').style.display = 'none'; 
        document.getElementById('game-hud').classList.add('is-visible');
        const s = this.instance.scene.getScene('SpaceMission');
        if (s) { s.gameStarted = true; s.distance = 0; s.score = 0; s.speed = 3; s.isQuizActive = false; s.nextQuestionDistance = 1000; s.hasShield = false; s.shieldGraphic.setVisible(false); }
    },

    showScreen(id) {
        document.querySelectorAll('.ui-screen').forEach(s => s.style.display = 'none');
        const el = document.getElementById(id); el.style.display = 'block'; el.classList.add('active');
    },

    renderQuestion() {
        if (!this.currentQuiz || !this.currentQuiz.questions[this.currentQuestionIndex]) { this.endGame(); return; }
        this.showScreen('quiz-overlay');
        const q = this.currentQuiz.questions[this.currentQuestionIndex];
        document.getElementById('question-text').textContent = q.text;
        document.getElementById('current-q').textContent = this.currentQuestionIndex + 1;
        const grid = document.getElementById('options-grid'); grid.innerHTML = '';
        q.options.forEach((opt, idx) => {
            const card = document.createElement('div'); card.className = 'option-card'; card.textContent = opt;
            card.onclick = () => this.handleAnswer(idx); grid.appendChild(card);
        });
        document.getElementById('energy-fill').style.width = `${((this.currentQuestionIndex + 1) / this.currentQuiz.questions.length) * 100}%`;
    },

    handleAnswer(idx) {
        const q = this.currentQuiz.questions[this.currentQuestionIndex], cards = document.querySelectorAll('.option-card'), s = this.instance.scene.getScene('SpaceMission');
        cards.forEach(c => c.style.pointerEvents = 'none');
        let correct = (idx === q.correctAnswer);
        if (correct) { cards[idx].classList.add('correct'); this.score += 200; this.correctCount++; }
        else { cards[idx].classList.add('wrong'); if (typeof q.correctAnswer === 'number') cards[q.correctAnswer].classList.add('correct'); if (s) s.shake(); }
        setTimeout(() => { document.getElementById('quiz-overlay').style.display = 'none'; this.currentQuestionIndex++; if (s) s.resumeFlight(correct); }, 1500);
    },

    endGame() {
        this.showScreen('result-screen'); document.getElementById('game-hud').classList.remove('is-visible');
        document.getElementById('final-score').textContent = Math.floor(this.score);
        const acc = Math.round((this.correctCount / this.currentQuiz.questions.length) * 100) || 0;
        document.getElementById('final-accuracy').textContent = `${acc}%`;
        const s = this.instance.scene.getScene('SpaceMission'); if (s) s.gameStarted = false;
    }
};

GameApp.init();

})();
