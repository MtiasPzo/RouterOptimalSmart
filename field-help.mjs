export function setupFieldHelp() {
  const bubble = document.createElement('div');
  bubble.className = 'field-help-bubble';
  bubble.hidden = true;
  bubble.setAttribute('aria-hidden', 'true');
  const prefix = document.createElement('span');
  prefix.id = 'field-help-prefix';
  prefix.hidden = true;
  prefix.textContent = 'Ayuda sobre';
  document.body.append(prefix, bubble);
  let active = null;
  let pinned = false;
  let hideTimer;

  function hide() {
    clearTimeout(hideTimer);
    active?.setAttribute('aria-expanded', 'false');
    active = null;
    pinned = false;
    bubble.hidden = true;
  }

  function position() {
    if (!active) return;
    const rect = active.getBoundingClientRect();
    const viewport = document.documentElement;
    if (!rect.width || rect.bottom < 0 || rect.top > viewport.clientHeight) {
      hide();
      return;
    }
    const margin = 10;
    const { offsetWidth: width, offsetHeight: height } = bubble;
    const left = Math.max(margin, Math.min(rect.right - width, viewport.clientWidth - width - margin));
    const roomBelow = viewport.clientHeight - rect.bottom - margin;
    const top = roomBelow < height && rect.top > roomBelow ? rect.top - height - 5 : rect.bottom + 5;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${Math.max(margin, top)}px`;
  }

  function show(button, description, keepOpen = false) {
    if (active !== button) hide();
    clearTimeout(hideTimer);
    active = button;
    pinned = keepOpen;
    bubble.textContent = description;
    bubble.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    position();
  }

  function hideAfterHover() {
    if (!pinned && !active?.matches(':focus-visible')) {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, 180);
    }
  }

  const controls = [...document.querySelectorAll('[data-help]')];
  for (const [index, control] of controls.entries()) {
    const description = control.dataset.help;
    const label = control.labels?.[0];
    const target = control.type === 'checkbox' ? label : control;
    const wrapper = document.createElement('div');
    wrapper.className = 'field-with-help';
    target.before(wrapper);
    wrapper.append(target);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'field-help-button';
    button.setAttribute('aria-expanded', 'false');
    if (label) {
      label.id ||= `${control.id}-label`;
      button.setAttribute('aria-labelledby', `${prefix.id} ${label.id}`);
    } else {
      button.setAttribute('aria-label', `Ayuda sobre ${control.getAttribute('aria-label')}`);
    }

    const mark = document.createElement('span');
    mark.textContent = '?';
    mark.setAttribute('aria-hidden', 'true');
    button.append(mark);
    const text = document.createElement('span');
    text.id = `field-help-text-${index + 1}`;
    text.hidden = true;
    text.textContent = description;
    button.setAttribute('aria-describedby', text.id);
    wrapper.append(button, text);

    button.addEventListener('pointerenter', event => {
      if (event.pointerType === 'mouse' && !pinned) show(button, description);
    });
    button.addEventListener('pointerleave', hideAfterHover);
    button.addEventListener('focus', () => {
      if (button.matches(':focus-visible')) show(button, description);
    });
    button.addEventListener('blur', () => { if (active === button) hide(); });
    button.addEventListener('click', () => {
      if (active === button && pinned) hide();
      else show(button, description, true);
    });
  }

  bubble.addEventListener('pointerenter', () => clearTimeout(hideTimer));
  bubble.addEventListener('pointerleave', hideAfterHover);
  document.addEventListener('pointerdown', event => {
    if (active && !active.contains(event.target) && !bubble.contains(event.target)) hide();
  });
  document.addEventListener('keydown', event => {
    if (active && event.key === 'Escape') hide();
  });
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, { capture: true, passive: true });
}
