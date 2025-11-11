import L from "leaflet";
import { auth, db } from "./firebase/firebase.js";
import { signOut, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

/* Fix default icon URLs for Leaflet when loaded from esm.sh */
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png"
});

const statusEl = document.getElementById("status");
const findBtn = document.getElementById("findBtn");
const locateBtn = document.getElementById("locateBtn");
const resultsEl = document.getElementById("results");
const radiusInput = document.getElementById("radius");
const radiusVal = document.getElementById("radiusVal");
const logoutBtn = document.getElementById("logoutBtn");
const userLabel = document.getElementById("userLabel");

let map, userMarker, markersLayer;
let userCoords = null;

function initMap() {
  map = L.map("map", { zoomControl: true }).setView([0,0], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: ' OpenStreetMap'
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);
}

function setStatus(msg, err=false){
  statusEl.textContent = msg;
  statusEl.style.color = err ? "crimson" : "";
}

function onLocationFound(lat, lon) {
  userCoords = [lat, lon];
  if (userMarker) markersLayer.removeLayer(userMarker);
  userMarker = L.circleMarker(userCoords, { radius:7, color:"#1a73e8", fillColor:"#1a73e8", fillOpacity:0.9 }).addTo(markersLayer);
  map.setView(userCoords, 14);
  setStatus("Ubicación detectada");
}

function geolocate() {
  if (!navigator.geolocation) {
    setStatus("Geolocalización no soportada", true);
    return;
  }
  setStatus("Obteniendo ubicación...");
  navigator.geolocation.getCurrentPosition(pos => {
    onLocationFound(pos.coords.latitude, pos.coords.longitude);
  }, err => {
    setStatus("Error obteniendo ubicación: " + err.message, true);
  }, {enableHighAccuracy:true, timeout:10000});
}

async function fetchHospitals(lat, lon, radius) {
  const query = `[out:json][timeout:25];(node["amenity"="hospital"](around:${radius},${lat},${lon});way["amenity"="hospital"](around:${radius},${lat},${lon});relation["amenity"="hospital"](around:${radius},${lat},${lon}););out center tags;`;
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { method: "POST", body: query });
      if (!res.ok) throw new Error(`Overpass error ${res.status} (${new URL(url).host})`);
      const data = await res.json();
      return data.elements.map(el => {
        const latlng = el.type === "node" ? [el.lat, el.lon] : [el.center.lat, el.center.lon];
        return { id: el.id, name: el.tags && (el.tags.name || el.tags.operator) || "Hospital sin nombre", tags: el.tags || {}, latlng };
      });
    } catch (err) {
      console.warn("Overpass attempt failed:", err);
      // try next endpoint
    }
  }
  throw new Error("No se pudo contactar con Overpass API. Intenta de nuevo más tarde.");
}

function clearResults() {
  resultsEl.innerHTML = "";
  markersLayer.clearLayers();
  if (userMarker) userMarker.addTo(markersLayer);
}

function addResultToList(hospitals, origin) {
  clearResults();
  if (!hospitals.length) {
    setStatus("No se encontraron hospitales en este radio", true);
    return;
  }
  setStatus(`${hospitals.length} hospitales encontrados`);
  hospitals.forEach((h, idx) => {
    const li = document.createElement("li");
    li.className = "result";
    const dist = origin ? (distanceMeters(origin, h.latlng).toFixed(0) + " m") : "";
    li.innerHTML = `<div class="title">${h.name}</div><div class="meta">${h.tags.street || ""} ${dist}</div>`;
    li.addEventListener("click", () => {
      map.setView(h.latlng, 17);
    });
    resultsEl.appendChild(li);

    const marker = L.marker(h.latlng).bindPopup(`<strong>${h.name}</strong><br>${h.tags.phone||""}`);
    markersLayer.addLayer(marker);
  });
}

function distanceMeters([lat1,lon1],[lat2,lon2]){
  const toRad = d=>d*Math.PI/180;
  const R=6371000;
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R*c;
}

/* --- Authentication (Firebase) --- */
const AUTH_KEY = "hosp_app_user_v2";

function getCurrentUser() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && obj.name ? obj : null;
  } catch (e) {
    return null;
  }
}

function setCurrentUser(obj) {
  try {
    if (obj && obj.name) localStorage.setItem(AUTH_KEY, JSON.stringify(obj));
    else localStorage.removeItem(AUTH_KEY);
  } catch (e) {}
  updateAuthUI();
}

async function updateAuthUI() {
  const user = getCurrentUser();
  if (user) {
    userLabel.textContent = `Hola, ${user.name}`;
    logoutBtn.style.display = "inline-block";
    enableControls(true);
  } else {
    // no user: redirect to login page
    window.location.href = "login.html";
  }
}

function enableControls(enabled) {
  findBtn.disabled = !enabled;
  locateBtn.disabled = !enabled;
  radiusInput.disabled = !enabled;
}

/* --- Event handlers for auth --- */
logoutBtn.addEventListener("click", async ()=>{
  try {
    await signOut(auth);
    setCurrentUser(null);
    setStatus("Sesión cerrada");
    setTimeout(() => {
      window.location.href = "login.html";
    }, 500);
  } catch (error) {
    console.error("Error al cerrar sesión:", error);
    setStatus("Error al cerrar sesión", true);
  }
});

// Verificar estado de autenticación de Firebase
onAuthStateChanged(auth, async (firebaseUser) => {
  if (firebaseUser) {
    // Usuario autenticado en Firebase
    try {
      const userData = await getDoc(doc(db, "usuarios", firebaseUser.uid));
      let displayName = firebaseUser.displayName || firebaseUser.email;
      
      if (userData.exists()) {
        const data = userData.data();
        if (data.nombre && data.apellido) {
          displayName = `${data.nombre} ${data.apellido}`.trim();
        } else if (data.nombre) {
          displayName = data.nombre;
        }
      }
      
      setCurrentUser({ 
        uid: firebaseUser.uid,
        name: displayName,
        email: firebaseUser.email 
      });
    } catch (error) {
      console.error("Error obteniendo datos del usuario:", error);
      
      // Si es un error de permisos, mostrar advertencia pero continuar
      if (error.code === "permission-denied" || error.message.includes("permission")) {
        console.warn("⚠️ ADVERTENCIA: No se tienen permisos para leer datos de Firestore. Verifica las reglas de seguridad.");
        // Continuar con los datos básicos de Auth
        setCurrentUser({ 
          uid: firebaseUser.uid,
          name: firebaseUser.displayName || firebaseUser.email,
          email: firebaseUser.email 
        });
      } else {
        // Para otros errores, también continuar con datos básicos
        setCurrentUser({ 
          uid: firebaseUser.uid,
          name: firebaseUser.displayName || firebaseUser.email,
          email: firebaseUser.email 
        });
      }
    }
  } else {
    // No hay usuario autenticado
    setCurrentUser(null);
  }
});

/* --- Existing event handlers --- */
findBtn.addEventListener("click", async ()=>{
  const user = getCurrentUser();
  if (!user) {
    setStatus("Debes iniciar sesión para buscar", true);
    return;
  }
  if (!userCoords) {
    setStatus("Primero permite la geolocalización y centra en tu ubicación", true);
    return;
  }
  const radius = Number(radiusInput.value);
  setStatus("Buscando hospitales...");
  try {
    const hospitals = await fetchHospitals(userCoords[0], userCoords[1], radius);
    addResultToList(hospitals, userCoords);
  } catch (e) {
    setStatus(e.message, true);
  }
});

locateBtn.addEventListener("click", ()=>{
  const user = getCurrentUser();
  if (!user) {
    setStatus("Debes iniciar sesión para usar la ubicación", true);
    return;
  }
  if (userCoords) map.setView(userCoords, 14);
  else geolocate();
});

radiusInput.addEventListener("input", ()=> radiusVal.textContent = radiusInput.value);

// init
initMap();
geolocate();

// La verificación de autenticación se hace en onAuthStateChanged
// que actualiza la UI automáticamente