// Injected before game SDK runs — spoofs document.referrer so gamedistribution
// accepts the embed as coming from lofgames.com
Object.defineProperty(document, 'referrer', {
  get: () => 'https://www.lofgames.com/',
  configurable: true,
});
