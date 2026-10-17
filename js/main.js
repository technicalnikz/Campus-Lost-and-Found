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
  document.querySelectorAll('.theme-toggle').forEach(button => {
    if (button.dataset.themeBound === 'true') return;
    button.dataset.themeBound = 'true';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      toggleTheme();
    });
  });
  document.querySelectorAll('.navbar').forEach(initializeMobileDrawer);
}

function initializeMobileDrawer(navbar) {
  const links = navbar.querySelector('.nav-links');
  if (!links) return;

  const container = navbar.querySelector('.navbar-container');
  const logo = container && container.querySelector('.nav-logo');
  const menuButton = navbar.querySelector('.menu-toggle');
  if (container && logo && menuButton && menuButton.parentElement !== container) {
    container.insertBefore(menuButton, logo);
  }

  let closeButton = links.querySelector('.mobile-drawer-close');
  if (!closeButton) {
    closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'mobile-drawer-close';
    closeButton.setAttribute('aria-label', 'Close navigation menu');
    closeButton.textContent = '\u00d7';
  }

  let drawerHeader = links.querySelector('.mobile-drawer-header');
  if (!drawerHeader) {
    drawerHeader = document.createElement('div');
    drawerHeader.className = 'mobile-drawer-header';
    if (logo) {
      const brand = document.createElement('a');
      const logoImage = logo.querySelector('img');
      const logoTitle = logo.querySelector('.nav-logo-full, .nav-logo-short');
      brand.className = 'mobile-drawer-brand';
      brand.href = logo.href;
      if (logoImage) brand.append(logoImage.cloneNode(true));
      brand.append(document.createTextNode(logoTitle ? logoTitle.textContent.trim() : 'Back2You'));
      drawerHeader.append(brand);
    }
  }
  drawerHeader.append(closeButton);
  links.prepend(drawerHeader);

  let profile = links.querySelector('.mobile-drawer-profile');
  if (!profile) {
    profile = document.createElement('div');
    profile.className = 'mobile-drawer-profile';
    profile.hidden = true;
  }
  drawerHeader.after(profile);

  let footer = links.querySelector('.mobile-drawer-footer');
  if (!footer) {
    footer = document.createElement('div');
    footer.className = 'mobile-drawer-footer';
    links.append(footer);
  }

  links.querySelectorAll('a, .nav-register-mobile').forEach(link => {
    const label = link.textContent.trim().toLowerCase();
    link.dataset.mobileIcon = label.includes('report') ? 'report'
      : label.includes('register') ? 'register'
        : label.includes('item') || label.includes('browse') ? 'items'
          : label.includes('dashboard') ? 'dashboard' : '';
  });

  let backdrop = navbar.querySelector('.nav-drawer-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'nav-drawer-backdrop';
    backdrop.setAttribute('aria-label', 'Close navigation menu');
    backdrop.hidden = true;
    navbar.append(backdrop);
  }

  if (menuButton) {
    menuButton.setAttribute('aria-controls', links.id || 'navLinks');
    menuButton.setAttribute('aria-expanded', String(links.classList.contains('open')));
  }

  syncMobileHeaderControls(navbar);
  syncMobileDrawerAccount(navbar);
  if (navbar.dataset.mobileDrawerReady !== 'true') {
    navbar.dataset.mobileDrawerReady = 'true';
    const accountSlot = navbar.querySelector('#userNavSlot');
    if (accountSlot) {
      new MutationObserver(() => {
        syncMobileHeaderControls(navbar);
        syncMobileDrawerAccount(navbar);
      })
        .observe(accountSlot, { childList: true, subtree: true });
    }
  }
}

function syncMobileHeaderControls(navbar) {
  const actions = navbar.querySelector('.nav-actions');
  if (!actions) return;

  const account = navbar.querySelector('.user-pill');
  const authenticated = Boolean(account);
  navbar.classList.toggle('mobile-authenticated', authenticated);

  let signInButton = actions.querySelector('.mobile-header-signin');
  if (!authenticated && !navbar.classList.contains('admin-navbar')) {
    const source = navbar.querySelector('.nav-signin-btn');
    if (!signInButton) {
      signInButton = source ? source.cloneNode(true) : document.createElement('a');
      signInButton.className = 'mobile-header-signin';
      signInButton.removeAttribute('id');
      if (!source) {
        signInButton.href = '/login';
        signInButton.textContent = 'Sign In';
      }
      actions.append(signInButton);
    }
  } else {
    signInButton?.remove();
  }

  const notifications = [...navbar.querySelectorAll('.notif-bell-btn')];
  const directNotification = actions.querySelector('.notif-bell-btn:not(.mobile-header-notification)');
  const notification = directNotification || notifications[0];
  let mobileNotification = actions.querySelector('.mobile-header-notification');

  if (authenticated && notification && !navbar.classList.contains('admin-navbar')) {
    notification.classList.add('mobile-header-notification-source');
    if (mobileNotification) mobileNotification.remove();
    notifications.forEach(candidate => {
      if (candidate !== notification) candidate.remove();
    });
  } else if (authenticated && notification && navbar.classList.contains('admin-navbar')) {
    if (!mobileNotification) {
      mobileNotification = notification.cloneNode(true);
      mobileNotification.classList.add('mobile-header-notification');
      mobileNotification.removeAttribute('id');
      mobileNotification.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
      actions.append(mobileNotification);
    }
  } else {
    mobileNotification?.remove();
  }
}

function syncMobileDrawerAccount(navbar) {
  const links = navbar.querySelector('.nav-links');
  const profile = links && links.querySelector('.mobile-drawer-profile');
  const footer = links && links.querySelector('.mobile-drawer-footer');
  if (!profile || !footer) return;

  const account = navbar.querySelector('.user-pill');
  const name = account && account.querySelector('.user-name')?.textContent.trim();
  const role = account?.querySelector('.role-badge')?.textContent.trim()
    || (navbar.classList.contains('admin-navbar') ? 'Administrator' : '');

  profile.replaceChildren();
  profile.hidden = !name;
  if (name) {
    const avatar = document.createElement('span');
    avatar.className = 'mobile-drawer-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();

    const details = document.createElement('span');
    details.className = 'mobile-drawer-account-details';
    const userName = document.createElement('strong');
    userName.textContent = name;
    details.append(userName);
    if (role) {
      const userRole = document.createElement('span');
      userRole.className = 'mobile-drawer-role-badge';
      userRole.textContent = role;
      details.append(userRole);
    }
    profile.append(avatar, details);
  }

  footer.replaceChildren();
  const logout = account?.querySelector('.user-pill-logout');
  if (logout) {
    const drawerLogout = logout.cloneNode(true);
    drawerLogout.className = 'mobile-drawer-logout';
    drawerLogout.textContent = 'Logout';
    drawerLogout.title = 'Sign out of account';
    footer.append(drawerLogout);
    return;
  }

  const signIn = navbar.querySelector('.mobile-header-signin, .nav-signin-btn');
  if (signIn) {
    const drawerSignIn = signIn.cloneNode(true);
    drawerSignIn.className = 'mobile-drawer-signin';
    footer.append(drawerSignIn);
  }
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
  if (!links) return;
  initializeMobileDrawer(navbar);
  if (links.classList.contains('open')) {
    closeMobileNav(navbar, false);
    return;
  }

  links.classList.add('open');
  navbar.classList.add('mobile-drawer-active');
  navbar.querySelector('.nav-drawer-backdrop').hidden = false;
  button.setAttribute('aria-expanded', 'true');
  button.setAttribute('aria-label', 'Close navigation menu');
  button.classList.add('open');
  document.body.classList.add('mobile-drawer-open');
}

function closeMobileNav(navbar, returnFocus = false) {
  const links = navbar.querySelector('.nav-links');
  const button = navbar.querySelector('.menu-toggle');
  if (!links || !button) return;
  links.classList.remove('open');
  navbar.classList.remove('mobile-drawer-active');
  navbar.querySelector('.nav-drawer-backdrop').hidden = true;
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', 'Open navigation menu');
  button.classList.remove('open');
  document.body.classList.remove('mobile-drawer-open');
  if (returnFocus) button.focus();
}

loadTheme();
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initButtonSelects();
});
document.addEventListener('click', event => {
  if (event.target.closest('.theme-toggle')) {
    if (event.target.closest('.theme-toggle').dataset.themeBound === 'true') return;
    toggleTheme();
    return;
  }

  if (event.target.closest('.menu-toggle')) {
    event.stopPropagation();
    toggleMobileNav(event);
    return;
  }

  if (event.target.closest('.nav-drawer-backdrop')) {
    const navbar = event.target.closest('.navbar');
    if (navbar) closeMobileNav(navbar, true);
    return;
  }

  document.querySelectorAll('.nav-links.open').forEach(links => {
    const navbar = links.closest('.navbar');
    if (event.target.closest('.nav-links a, .nav-links button')) {
      closeMobileNav(navbar);
    }
  });
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    document.querySelectorAll('.nav-links.open').forEach(links => closeMobileNav(links.closest('.navbar'), true));
  }
});
