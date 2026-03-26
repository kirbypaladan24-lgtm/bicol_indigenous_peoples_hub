const target = "profile.html";

if (location.pathname.endsWith("/admin.html") || location.pathname.endsWith("\\admin.html")) {
  location.replace(target);
} else {
  location.replace(target);
}
