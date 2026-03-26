# Bicol Indigenous Peoples Hub

A community-centered digital platform dedicated to preserving and sharing the vibrant heritage of Bicol's Indigenous Peoples — from the Agta of Mt. Isarog, Mt. Malinao, and Mt. Bulusan to the broader Indigenous communities of the Bicol Region.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Firebase](https://img.shields.io/badge/firebase-FFCA28?logo=firebase&logoColor=black)
![Vercel](https://img.shields.io/badge/vercel-000000?logo=vercel&logoColor=white)

## 🌟 Features

### Core Functionality
- **Multilingual Support** — Tagalog, Central Bicol, Rinconada Bicol, Albay Bicol, Northern Catanduanes Bicol, and Bisakol
- **Interactive Map** — Leaflet-powered map with offline tile caching, marker clustering, and proximity alerts for culturally sensitive sites
- **Community Posts** — Rich text editor with image uploads (up to 10 per post), reactions, and sharing
- **User Authentication** — Email/password with profile management
- **Admin Panel** — Content moderation, landmark management, and user analytics

### Technical Features
- **Offline Support** — Service worker with background sync
- **Security** — CSP headers, input sanitization, XSS protection, rate limiting
- **Privacy** — GDPR-compliant analytics (no cookies, anonymized data)
- **Performance** — Virtual scrolling, lazy loading, image optimization
- **Accessibility** — WCAG 2.1 AA compliant, keyboard navigation, screen reader support

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Firebase account
- ImgBB account (for image hosting)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/bicol-ip-hub.git
   cd bicol-ip-hub
Install dependencies
bash
Copy
npm install
Environment setup
bash
Copy
cp .env.example .env
# Edit .env with your Firebase and ImgBB credentials
Start development server
bash
Copy
npm run dev
Build for production
bash
Copy
npm run build
📁 Project Structure
plain
Copy
bicol-ip-hub/
├── index.html              # Main landing page
├── signup.html             # User registration
├── profile.html            # User profile & posts
├── admin.html              # Admin dashboard
├── landmark.html           # Individual landmark view
├── policy.html             # Privacy & content policy
├── sw.js                   # Service worker (offline support)
├── firebase-config.js      # Secure Firebase configuration
├── security.js             # CSP, sanitization, error boundaries
├── utils.js                # Virtual scrolling, skeleton loaders
├── map-enhancements.js     # Marker clustering, geofencing
├── analytics.js            # Privacy-respecting analytics
├── i18n.js                 # Internationalization (6 languages)
├── app.js                  # Main application logic
├── auth.js                 # Firebase authentication
├── ui.js                   # UI components & rendering
├── imgbb.js                # Image upload handling
├── admin.js                # Admin panel functionality
├── profile.js              # Profile page logic
├── landmark.js             # Landmark page logic
├── signup.js               # Registration logic
├── styles.css              # Main stylesheet
├── styles-additions.css    # Skeleton, accessibility, print styles
├── .env.example            # Environment variables template
├── vite.config.js          # Build configuration
└── README.md               # This file