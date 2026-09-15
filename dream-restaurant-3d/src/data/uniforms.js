// uniforms.js — 服務生與廚師的制服預設
//   每套制服定義角色各部位的顏色，會套到 characters.js 的人物產生器

export const UNIFORMS = {
  // ── 服務生（ホール）──
  waiter_classic: {
    role: 'waiter', label: '經典黑白', labelZh: '經典黑白',
    shirt: '#f0eee8', vest: '#1d2530', pants: '#1d2530', shoes: '#1a1a1a', accent: '#c0392b'
  },
  waiter_casual: {
    role: 'waiter', label: '休閒丹寧', labelZh: '休閒丹寧',
    shirt: '#3a6ea5', vest: '#3a6ea5', pants: '#2a3a4a', shoes: '#4a3a2a', accent: '#e0d0b0'
  },
  waiter_jazz: {
    role: 'waiter', label: '爵士酒館', labelZh: '爵士酒館',
    shirt: '#e8e0d0', vest: '#2a1810', pants: '#2a1810', shoes: '#1a0e08', accent: '#c9a227'
  },
  waiter_idol: {
    role: 'waiter', label: '偶像風', labelZh: '偶像風',
    shirt: '#ffd0e0', vest: '#ff6b9d', pants: '#2a2030', shoes: '#ffffff', accent: '#ff6b9d'
  },
  waiter_summer: {
    role: 'waiter', label: '夏日輕裝', labelZh: '夏日輕裝',
    shirt: '#ffffff', vest: '#4fc3f7', pants: '#1a3a4a', shoes: '#e0d0b0', accent: '#4fc3f7'
  },

  // ── 廚師（料理人）──
  chef_classic: {
    role: 'chef', label: '經典廚師', labelZh: '經典廚師',
    shirt: '#f5f0e8', pants: '#3a3028', hat: '#ffffff', shoes: '#2a2018', accent: '#ffffff',
    doubleBreasted: true
  },
  chef_modern: {
    role: 'chef', label: '現代主廚', labelZh: '現代主廚',
    shirt: '#2a2a2a', pants: '#1a1a1a', hat: '#2a2a2a', shoes: '#1a1a1a', accent: '#c0392b',
    doubleBreasted: false
  },
  chef_japanese: {
    role: 'chef', label: '和食職人', labelZh: '和食職人',
    shirt: '#d8d0c0', pants: '#2a1810', hat: '#2a1810', shoes: '#1a0e08', accent: '#8b4513',
    happi: true
  },
  chef_pizza: {
    role: 'chef', label: '披薩師傅', labelZh: '披薩師傅',
    shirt: '#ffffff', pants: '#3a2a1a', hat: '#c0392b', shoes: '#2a1a0a', accent: '#2e7d32',
    checkered: true
  },
  chef_pastry: {
    role: 'chef', label: '甜點師傅', labelZh: '甜點師傅',
    shirt: '#ffe0ec', pants: '#3a2a2a', hat: '#ffffff', shoes: '#2a1a1a', accent: '#ff69b4',
    doubleBreasted: true
  }
};

export const UNIFORM_IDS = Object.keys(UNIFORMS);

export function uniformsForRole(role) {
  return UNIFORM_IDS.filter((id) => UNIFORMS[id].role === role);
}

export function uniformById(id) {
  return UNIFORMS[id] || null;
}

export default UNIFORMS;
