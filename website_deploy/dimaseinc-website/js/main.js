// ============================================
// ANIMATED PARTICLE BACKGROUND
// ============================================
const canvas = document.getElementById('bg-canvas');
const ctx = canvas.getContext('2d');

let particles = [];
let connections = [];
const particleCount = 80;
const connectionDistance = 150;
const gold = { r: 212, g: 175, b: 55 };

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

class Particle {
    constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.vx = (Math.random() - 0.5) * 0.5;
        this.vy = (Math.random() - 0.5) * 0.5;
        this.radius = Math.random() * 2 + 1;
        this.opacity = Math.random() * 0.5 + 0.2;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;

        if (this.x < 0 || this.x > canvas.width) this.vx *= -1;
        if (this.y < 0 || this.y > canvas.height) this.vy *= -1;
    }

    draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${gold.r}, ${gold.g}, ${gold.b}, ${this.opacity})`;
        ctx.fill();

        // Glow effect
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius * 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${gold.r}, ${gold.g}, ${gold.b}, ${this.opacity * 0.3})`;
        ctx.fill();
    }
}

function initParticles() {
    particles = [];
    for (let i = 0; i < particleCount; i++) {
        particles.push(new Particle());
    }
}

function drawConnections() {
    for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
            const dx = particles[i].x - particles[j].x;
            const dy = particles[i].y - particles[j].y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < connectionDistance) {
                const opacity = (1 - distance / connectionDistance) * 0.3;
                ctx.beginPath();
                ctx.moveTo(particles[i].x, particles[i].y);
                ctx.lineTo(particles[j].x, particles[j].y);
                ctx.strokeStyle = `rgba(${gold.r}, ${gold.g}, ${gold.b}, ${opacity})`;
                ctx.lineWidth = 0.5;
                ctx.stroke();
            }
        }
    }
}

function drawHexGrid() {
    const hexSize = 60;
    const hexHeight = hexSize * Math.sqrt(3);
    ctx.strokeStyle = `rgba(${gold.r}, ${gold.g}, ${gold.b}, 0.03)`;
    ctx.lineWidth = 1;

    for (let row = -1; row < canvas.height / hexHeight + 1; row++) {
        for (let col = -1; col < canvas.width / (hexSize * 1.5) + 1; col++) {
            const x = col * hexSize * 1.5;
            const y = row * hexHeight + (col % 2 ? hexHeight / 2 : 0);
            drawHexagon(x, y, hexSize * 0.9);
        }
    }
}

function drawHexagon(x, y, size) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const hx = x + size * Math.cos(angle);
        const hy = y + size * Math.sin(angle);
        if (i === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.stroke();
}

function drawScanLine() {
    const time = Date.now() * 0.001;
    const y = (Math.sin(time * 0.5) + 1) / 2 * canvas.height;

    const gradient = ctx.createLinearGradient(0, y - 50, 0, y + 50);
    gradient.addColorStop(0, 'transparent');
    gradient.addColorStop(0.5, `rgba(${gold.r}, ${gold.g}, ${gold.b}, 0.05)`);
    gradient.addColorStop(1, 'transparent');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, y - 50, canvas.width, 100);
}

function animate() {
    ctx.fillStyle = 'rgba(10, 10, 10, 0.1)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Clear for fresh frame
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw background gradient
    const bgGradient = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, 0,
        canvas.width / 2, canvas.height / 2, canvas.width
    );
    bgGradient.addColorStop(0, '#1a1a1a');
    bgGradient.addColorStop(1, '#0a0a0a');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw hex grid
    drawHexGrid();

    // Draw scan line effect
    drawScanLine();

    // Update and draw particles
    particles.forEach(particle => {
        particle.update();
        particle.draw();
    });

    // Draw connections
    drawConnections();

    requestAnimationFrame(animate);
}

// Initialize
resizeCanvas();
initParticles();
animate();

window.addEventListener('resize', () => {
    resizeCanvas();
    initParticles();
});

// ============================================
// MOBILE MENU
// ============================================
const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
const navLinks = document.querySelector('.nav-links');

mobileMenuBtn.addEventListener('click', () => {
    navLinks.classList.toggle('active');
});

document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', () => {
        navLinks.classList.remove('active');
    });
});

// ============================================
// CONTACT FORM
// ============================================
const contactForm = document.getElementById('contactForm');

contactForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const formData = new FormData(contactForm);
    const name = formData.get('name');
    const email = formData.get('email');
    const message = formData.get('message');

    const subject = encodeURIComponent(`Contact from ${name}`);
    const body = encodeURIComponent(`Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`);
    window.location.href = `mailto:dimaseinc@gmail.com?subject=${subject}&body=${body}`;

    contactForm.reset();
});

// ============================================
// SMOOTH SCROLL
// ============================================
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// ============================================
// SCROLL ANIMATIONS
// ============================================
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, observerOptions);

document.querySelectorAll('.service-card').forEach(card => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(30px)';
    card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    observer.observe(card);
});
