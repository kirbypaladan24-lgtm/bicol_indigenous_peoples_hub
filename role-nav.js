function createSuperAdminLink({ mobile = false, currentPage = false } = {}) {
  const link = document.createElement("a");
  link.id = mobile ? "mobileSuperAdminBtn" : "superAdminBtn";
  link.href = "superadmin.html";
  link.textContent = "Super Admin";
  link.className = mobile ? "ghost full hidden" : "ghost hidden";
  if (currentPage) {
    link.setAttribute("aria-current", "page");
  }
  return link;
}

function insertBeforeReference(container, element) {
  if (!container || !element) return;
  const policyLink = container.querySelector('a[href="policy.html"]');
  const logoutButton = container.querySelector("#logoutBtn, #mobileLogoutBtn");
  const referenceNode = policyLink || logoutButton || null;

  if (referenceNode) {
    container.insertBefore(element, referenceNode);
    return;
  }

  container.appendChild(element);
}

export function ensureSuperAdminNavLink({ currentPage = false } = {}) {
  const desktopContainer = document.querySelector(".desktop-shortcuts .sidebar-actions");
  const mobileContainer = document.querySelector(".mobile-menu .mobile-actions");

  let desktopLink = document.getElementById("superAdminBtn");
  let mobileLink = document.getElementById("mobileSuperAdminBtn");

  if (!desktopLink && desktopContainer) {
    desktopLink = createSuperAdminLink({ currentPage });
    insertBeforeReference(desktopContainer, desktopLink);
  } else if (desktopLink && currentPage) {
    desktopLink.setAttribute("aria-current", "page");
  }

  if (!mobileLink && mobileContainer) {
    mobileLink = createSuperAdminLink({ mobile: true, currentPage });
    insertBeforeReference(mobileContainer, mobileLink);
  } else if (mobileLink && currentPage) {
    mobileLink.setAttribute("aria-current", "page");
  }

  return { desktopLink, mobileLink };
}

export function setSuperAdminNavVisible(visible, { currentPage = false } = {}) {
  const { desktopLink, mobileLink } = ensureSuperAdminNavLink({ currentPage });
  desktopLink?.classList.toggle("hidden", !visible);
  mobileLink?.classList.toggle("hidden", !visible);
}
