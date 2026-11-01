/**
 * SF TRACKER IA - tracker.js
 * Script de Rastreamento de Visitas e Captura de UTMs
 * Cole no <head> das suas páginas e presell:
 * <script src="https://sftrackeria.netlify.app/tracker.js" defer></script>
 */
(function() {
  const BACKEND_URL = 'https://sftrackeria.onrender.com';
  
  // Captura os parâmetros de URL da campanha
  const urlParams = new URLSearchParams(window.location.search);
  const utmData = {
    url: window.location.href,
    referrer: document.referrer || '',
    utm_source: urlParams.get('utm_source') || '',
    utm_campaign: urlParams.get('utm_campaign') || '',
    utm_medium: urlParams.get('utm_medium') || '',
    utm_content: urlParams.get('utm_content') || '',
    utm_term: urlParams.get('utm_term') || '',
    sck: urlParams.get('sck') || urlParams.get('src') || ''
  };

  // Salva no navegador para levar as UTMs até o checkout
  try {
    sessionStorage.setItem('sftracker_utm', JSON.stringify(utmData));
  } catch(e) {}

  // Envia visita para o painel em tempo real
  fetch(BACKEND_URL + '/api/v1/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(utmData),
    mode: 'cors'
  }).catch(() => {});
})();
