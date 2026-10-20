document.addEventListener('DOMContentLoaded', () => {
  const userNavSlot = document.getElementById('userNavSlot');
  if (!userNavSlot) {
    console.error('The About page account navigation is unavailable.');
    return;
  }

  const renderGuestNavigation = () => {
    const signInLink = document.createElement('a');
    signInLink.href = '/login';
    signInLink.className = 'btn btn-primary nav-signin-btn about-navbar-signin';
    signInLink.textContent = 'Sign In';
    userNavSlot.replaceChildren(signInLink);
  };

  const renderAuthenticatedNavigation = user => {
    const userPill = document.createElement('div');
    userPill.className = 'user-pill';

    const userName = document.createElement('span');
    userName.className = 'user-name';
    userName.textContent = user.role === 'admin' ? 'Admin' : user.fullName;
    userPill.append(userName);

    if (user.role === 'student') {
      const roleBadge = document.createElement('span');
      roleBadge.className = 'role-badge';
      roleBadge.textContent = 'Student';
      userPill.append(roleBadge);
    }

    const logoutButton = document.createElement('button');
    logoutButton.type = 'button';
    logoutButton.className = 'user-pill-logout';
    logoutButton.title = 'Sign out of account';
    logoutButton.textContent = 'Logout';
    logoutButton.addEventListener('click', logout);
    userPill.append(logoutButton);
    userNavSlot.replaceChildren(userPill);
  };

  async function logout() {
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error(`Logout request failed (${response.status}).`);
      renderGuestNavigation();
    } catch (error) {
      console.error('Unable to sign out from the About page:', error);
      window.alert('Unable to sign out. Please try again.');
    }
  }

  async function loadAccountNavigation() {
    try {
      const response = await fetch('/api/auth/me', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error(`Session check failed (${response.status}).`);
      const data = await response.json();

      if (data.authenticated && data.user && ['admin', 'student'].includes(data.user.role)) {
        renderAuthenticatedNavigation(data.user);
      } else {
        renderGuestNavigation();
      }
    } catch (error) {
      console.error('Unable to verify the About page account session:', error);
    }
  }

  loadAccountNavigation();
});
