/* ==================== Scroll Reveal ==================== */
const revealEls = document.querySelectorAll('.reveal')

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        // 交错动画
        setTimeout(() => {
          entry.target.classList.add('visible')
        }, Math.min(i * 80, 400))
        observer.unobserve(entry.target)
      }
    })
  },
  { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
)

revealEls.forEach((el) => observer.observe(el))

/* ==================== FAQ Accordion ==================== */
const faqItems = document.querySelectorAll('.faq-item')

faqItems.forEach((item) => {
  const q = item.querySelector('.faq-q')
  const a = item.querySelector('.faq-a')

  q.addEventListener('click', () => {
    const isOpen = item.classList.contains('open')

    // 关闭其他
    faqItems.forEach((other) => {
      other.classList.remove('open')
      other.querySelector('.faq-a').style.maxHeight = '0'
      other.querySelector('.faq-q').setAttribute('aria-expanded', 'false')
    })

    // 切换当前
    if (!isOpen) {
      item.classList.add('open')
      a.style.maxHeight = a.scrollHeight + 'px'
      q.setAttribute('aria-expanded', 'true')
    }
  })
})

/* ==================== Nav Scroll Effect ==================== */
const nav = document.querySelector('.nav')
let lastY = 0

window.addEventListener('scroll', () => {
  const y = window.scrollY
  if (y > 40) {
    nav.style.padding = '8px 32px'
    nav.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.3)'
  } else {
    nav.style.padding = '14px 32px'
    nav.style.boxShadow = ''
  }
  lastY = y
}, { passive: true })

/* ==================== Hero Preview Tilt ==================== */
const previewFrame = document.querySelector('.preview-frame')
const heroPreview = document.querySelector('.hero-preview')

if (previewFrame && heroPreview) {
  heroPreview.addEventListener('mousemove', (e) => {
    const rect = heroPreview.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width - 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5
    previewFrame.style.transform = `rotateX(${8 - y * 6}deg) rotateY(${x * 6}deg)`
  })

  heroPreview.addEventListener('mouseleave', () => {
    previewFrame.style.transform = 'rotateX(8deg) rotateY(0deg)'
  })
}

/* ==================== Smooth Anchor Scrolling ==================== */
document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (e) => {
    const href = link.getAttribute('href')
    if (href === '#') return
    const target = document.querySelector(href)
    if (target) {
      e.preventDefault()
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  })
})
