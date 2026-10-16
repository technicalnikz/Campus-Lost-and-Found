const THEME_STORAGE_KEY = 'cspc_theme';

function loadTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  const theme = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeIcon();
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const nextTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', nextTheme);
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  updateThemeIcon();
}

function updateThemeIcon() {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  document.querySelectorAll('.theme-toggle').forEach(button => {
    button.innerHTML = `<span class="theme-toggle-icon">${theme === 'light' ? '\u2600\ufe0f' : '\ud83c\udf19'}</span>`;
    button.setAttribute('title', theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode');
    button.setAttribute('aria-label', theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode');
  });
}

function initNav() {
  updateThemeIcon();
}

function syncButtonSelect(select) {
  const control = select && select.nextElementSibling;
  if (!control || !control.classList.contains('button-select')) return;

  const trigger = control.querySelector('.button-select-trigger');
  const menu = control.querySelector('.button-select-menu');
  const selectedOption = select.options[select.selectedIndex];
  trigger.textContent = selectedOption ? selectedOption.textContent.trim() : 'Select an option...';
  trigger.classList.toggle('has-value', Boolean(select.value));
  menu.querySelectorAll('[role="option"]').forEach(button => {
    const selected = button.dataset.value === select.value;
    button.setAttribute('aria-selected', String(selected));
    button.classList.toggle('selected', selected);
  });

  const selectedButton = [...menu.querySelectorAll('[role="option"]')]
    .find(button => button.dataset.value === select.value);
  if (selectedButton) selectedButton.scrollIntoView({ block: 'nearest' });
}

function closeButtonSelect(control, returnFocus = false) {
  if (!control) return;
  control.classList.remove('open');
  control.querySelector('.button-select-trigger').setAttribute('aria-expanded', 'false');
  if (returnFocus) control.querySelector('.button-select-trigger').focus();
}

function renderButtonSelectOptions(select, menu) {
  menu.replaceChildren();
  const addOption = option => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button-select-option';
    button.setAttribute('role', 'option');
    button.dataset.value = option.value;
    button.textContent = option.textContent.trim();
    button.disabled = option.disabled;
    button.setAttribute('aria-selected', String(option.value === select.value));
    button.classList.toggle('selected', option.value === select.value);
    button.addEventListener('click', () => {
      select.value = option.value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      syncButtonSelect(select);
      closeButtonSelect(menu.closest('.button-select'), true);
    });
    menu.append(button);
  };

  [...select.children].forEach(child => {
    if (child.tagName === 'OPTGROUP') {
      const group = document.createElement('div');
      group.className = 'button-select-group-label';
      group.textContent = child.label;
      menu.append(group);
      [...child.children].forEach(addOption);
    } else if (child.tagName === 'OPTION') {
      addOption(child);
    }
  });
}

function enhanceSelect(select) {
  if (select.dataset.buttonSelectReady === 'true' || !select.parentNode) return;

  select.dataset.buttonSelectReady = 'true';
  const wasRequired = select.required;
  select.required = false;
  select.classList.add('button-select-native');
  select.setAttribute('aria-hidden', 'true');
  select.tabIndex = -1;

  const control = document.createElement('div');
  control.className = 'button-select';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'button-select-trigger';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-required', String(wasRequired));
  trigger.setAttribute('aria-label', select.labels?.[0]?.textContent.trim() || 'Select an option');
  trigger.setAttribute('aria-controls', `${select.id || `button-select-${Date.now()}`}-options`);
  trigger.dataset.required = String(wasRequired);
  const menu = document.createElement('div');
  menu.id = trigger.getAttribute('aria-controls');
  menu.className = 'button-select-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', select.labels?.[0]?.textContent.trim() || 'Options');
  trigger.addEventListener('click', () => {
    syncButtonSelect(select);
    const opening = !control.classList.contains('open');
    document.querySelectorAll('.button-select.open').forEach(openSelect => closeButtonSelect(openSelect));
    control.classList.toggle('open', opening);
    trigger.setAttribute('aria-expanded', String(opening));
  });
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!control.classList.contains('open')) trigger.click();
      const options = [...menu.querySelectorAll('[role="option"]:not(:disabled)')];
      const selectedIndex = options.findIndex(option => option.getAttribute('aria-selected') === 'true');
      options[Math.max(0, selectedIndex)].focus();
    } else if (event.key === 'Escape' && control.classList.contains('open')) {
      event.preventDefault();
      closeButtonSelect(control);
    }
  });
  menu.addEventListener('keydown', event => {
    const options = [...menu.querySelectorAll('[role="option"]:not(:disabled)')];
    const currentIndex = options.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeButtonSelect(control, true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      options[(currentIndex + direction + options.length) % options.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      options[event.key === 'Home' ? 0 : options.length - 1]?.focus();
    }
  });
  select.addEventListener('change', () => syncButtonSelect(select));

  select.after(control);
  control.append(trigger, menu);
  renderButtonSelectOptions(select, menu);
  syncButtonSelect(select);
}

function initButtonSelects() {
  document.querySelectorAll('select').forEach(enhanceSelect);
  const observer = new MutationObserver(records => {
    records.forEach(record => {
      if (record.type === 'childList') {
        record.addedNodes.forEach(node => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          if (node.matches('select')) enhanceSelect(node);
          node.querySelectorAll('select').forEach(enhanceSelect);
        });
        const select = record.target.closest('select');
        if (select?.dataset.buttonSelectReady === 'true') {
          renderButtonSelectOptions(select, select.nextElementSibling.querySelector('.button-select-menu'));
          syncButtonSelect(select);
        }
      }
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('click', event => {
    if (event.target.closest('.button-select')) return;
    document.querySelectorAll('.button-select.open').forEach(control => closeButtonSelect(control));
  });
  document.querySelectorAll('form').forEach(form => {
    form.addEventListener('reset', () => {
      window.setTimeout(() => form.querySelectorAll('select').forEach(syncButtonSelect));
    });
  });
}

function toggleMobileNav(event) {
  const button = event.target.closest('.menu-toggle');
  const navbar = button && button.closest('.navbar');
  const links = navbar && navbar.querySelector('.nav-links');
  if (links) links.classList.toggle('open');
}

loadTheme();
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initButtonSelects();
});
document.addEventListener('click', event => {
  if (event.target.closest('.theme-toggle')) {
    toggleTheme();
    return;
  }

  if (event.target.closest('.menu-toggle')) {
    event.stopPropagation();
    toggleMobileNav(event);
    return;
  }

  document.querySelectorAll('.nav-links.open').forEach(links => {
    const navbar = links.closest('.navbar');
    if (navbar && !navbar.contains(event.target) || event.target.closest('.nav-links a, .nav-links button')) {
      links.classList.remove('open');
    }
  });
});
