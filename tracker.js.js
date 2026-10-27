/**
 * SF TRACKER IA - Client-Side Tracking Tag
 * Salva parâmetros da URL em 1st-party cookies e injeta no checkout
 */
(function () {
  const STORAGE_KEY = 'sf_tracker_utm_params';
  const CHECKOUT_DOMAINS = [
    'kiwify.com.br',
    'cackto.com.br',
    'cacktopay.com.br',
    'greenn.com.br',
    'hotmart.com',
    'perfectpay.com.br'
  ];

  // 1. Extrai parâmetros da URL atual
  function getQueryParams() {
    const params = new URLSearchParams(window.location.search);
    const result = {};
    for (const [key, value] of params.entries()) {
      result[key] = value;
    }
    return result;
  }

  // 2. Salva e recupera dados com validade de 30 dias
  function saveParams(params) {
    if (Object.keys(params).length === 0) return;
    
    // Salva no LocalStorage
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
    } catch (e) {}

    // Salva em Cookies primários (1st-Party)
    const date = new Date();
    date.setTime(date.getTime() + (30 * 24 * 60 * 60 * 1000));
    const expires = '; expires=' + date.toUTCString();
    
    for (const key in params) {
      document.cookie = `${key}=${encodeURIComponent(params[key])}${expires}; path=/; SameSite=Lax`;
    }
  }

  function getStoredParams() {
    let stored = {};
    try {
      const item = localStorage.getItem(STORAGE_KEY);
      if (item) stored = JSON.parse(item);
    } catch (e) {}
    return stored;
  }

  // 3. Monta o SCK padronizado para o checkout
  function buildTrackingQuery(stored) {
    const urlParams = getQueryParams();
    const active = Object.assign({}, stored, urlParams);

    saveParams(active);

    const utmSource = active.utm_source || 'direct';
    const utmCampaign = active.utm_campaign || '';
    const utmMedium = active.utm_medium || '';
    const utmContent = active.utm_content || '';
    const utmTerm = active.utm_term || '';

    // Monta o payload unificado que entra no parâmetro 'sck' e 'src'
    // Formato: source|campaign|medium|content|term
    const sckCombined = [utmSource, utmCampaign, utmMedium, utmContent, utmTerm].join('|');

    const query = new URLSearchParams();
    if (active.utm_source) query.set('utm_source', active.utm_source);
    if (active.utm_campaign) query.set('utm_campaign', active.utm_campaign);
    if (active.utm_medium) query.set('utm_medium', active.utm_medium);
    if (active.utm_content) query.set('utm_content', active.utm_content);
    if (active.utm_term) query.set('utm_term', active.utm_term);
    
    // Injeta sck e src (compatível com Kiwify, Cackto e Green)
    query.set('sck', sckCombined);
    query.set('src', sckCombined);

    return query.toString();
  }

  // 4. Injeta os parâmetros em todos os links e botões de checkout
  function decorateCheckoutLinks() {
    const trackingQuery = buildTrackingQuery(getStoredParams());
    if (!trackingQuery) return;

    const links = document.querySelectorAll('a[href]');
    links.forEach(link => {
      try {
        const href = link.getAttribute('href');
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

        const isCheckout = CHECKOUT_DOMAINS.some(domain => href.includes(domain));
        if (isCheckout) {
          const url = new URL(href, window.location.href);
          const newParams = new URLSearchParams(trackingQuery);
          
          // Mantém parâmetros já existentes no checkout e adiciona os nossos
          for (const [key, value] of newParams.entries()) {
            if (!url.searchParams.has(key)) {
              url.searchParams.set(key, value);
            }
          }
          link.href = url.toString();
        }
      } catch (err) {}
    });
  }

  // Executa na carga e monitora novos botões inseridos dinamicamente
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', decorateCheckoutLinks);
  } else {
    decorateCheckoutLinks();
  }
  
  // Reexecuta periodicamente para páginas com Lazy Load / Modais de compra
  setInterval(decorateCheckoutLinks, 1500);
})();