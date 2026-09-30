// Content for every "New site" template, in Bulgarian and English. Sample text is realistic on purpose —
// the owner replaces it, but the site already reads like a finished one and passes the quality check.
const dark = (bg, bg2, surface, accent, accent2, extra = {}) => ({ dark: true, bg, bg2, surface, text: '#eef0f7', muted: '#a3abc2', line: 'rgba(255,255,255,.09)', accent, accent2, ...extra });
const light = (bg, bg2, surface, text, muted, accent, accent2, extra = {}) => ({ dark: false, bg, bg2, surface, text, muted, line: 'rgba(15,23,42,.10)', accent, accent2, ...extra });

const MAIL = 'mailto:hello@example.com';
const TEL = 'tel:+359888000000';
const contactRows = (L, extra = []) => [
  ['mail', L === 'bg' ? 'Имейл' : 'Email', 'hello@example.com', MAIL],
  ['phone', L === 'bg' ? 'Телефон' : 'Phone', '+359 888 000 000', TEL],
  ...extra,
];
const addr = (L) => ['pin', L === 'bg' ? 'Адрес' : 'Address', L === 'bg' ? 'ул. „Витоша“ 1, София' : '1 Vitosha St, Sofia'];
const week = (L, a, b, c) => (L === 'bg' ? [['Понеделник – петък', a], ['Събота', b], ['Неделя', c]] : [['Monday – Friday', a], ['Saturday', b], ['Sunday', c]]);

export const TEMPLATES = [
  // ------------------------------------------------------------------ business
  {
    id: 'landing', category: 'business', sf: 'sparkles.rectangle.stack', mark: 'bolt',
    theme: dark('#0b0f1a', '#10172a', '#131b2f', '#5b8cff', '#a26bff'),
    lang: {
      bg: {
        tagline: 'услуги, на които можете да разчитате', description: 'Какво правим, как работим и как да се свържете с нас.',
        nav: [['Услуги', '/#services'], ['Как работим', '/#process'], ['Отзиви', '/#reviews'], ['Контакт', '/#contact']], headerCta: ['Запитване', '/#contact'],
        pages: { index: {
          hero: { eyebrow: 'Нови клиенти този месец', title: 'Решаваме проблема ви <em>бързо и честно</em>', lead: 'Кажете ни какво ви трябва — ще получите ясна оферта до 24 часа, срок, който спазваме, и човек, който вдига телефона.', cta: ['Поискай оферта', '/#contact'], cta2: ['Виж услугите', '/#services'],
            card: { icon: 'shield', title: 'Защо клиентите остават', rows: [['Отговор', 'до 24 ч.'], ['Спазени срокове', '98%'], ['Гаранция', '12 месеца']], note: 'Числата са пример — сменете ги с вашите.' } },
          sections: [
            { type: 'cards', id: 'services', title: 'Какво правим', intro: 'Три неща, които правим най-добре. Опишете ги с думите на клиента, не с жаргона на бранша.', items: [['spark', 'Консултация', 'Разбираме задачата, преди да дадем цена. Първият разговор е безплатен.'], ['tools', 'Изпълнение', 'Работим по ясен план с междинни срокове и снимки на напредъка.'], ['shield', 'Поддръжка', 'След края оставаме на линия — гаранция и бърза реакция при нужда.']] },
            { type: 'steps', id: 'process', alt: true, title: 'Как работим', intro: 'Без изненади: знаете какво следва на всяка стъпка.', items: [['Разговор', 'Разказвате какво ви трябва — по телефона или на място.'], ['Оферта', 'До 24 часа получавате цена и срок в писмен вид.'], ['Работа', 'Изпълняваме и ви държим в течение.'], ['Предаване', 'Проверяваме заедно и получавате гаранция.']] },
            { type: 'stats', items: [['12+', 'години опит'], ['850', 'завършени проекта'], ['4.9/5', 'средна оценка'], ['24 ч.', 'време за отговор']] },
            { type: 'quotes', id: 'reviews', title: 'Какво казват клиентите', items: [['„Дойдоха точно когато казаха и оставиха всичко чисто. Препоръчвам.“', 'Мария Петрова, София'], ['„Офертата беше ясна, нямаше скрити разходи. Второ поръчване вече.“', 'Георги Иванов, Пловдив'], ['„Бърз отговор и истински човек отсреща — рядкост.“', 'Елена Димитрова, Варна']] },
            { type: 'cta', h: 'Готови ли сте да започнем?', p: 'Пишете ни днес — отговаряме в рамките на един работен ден.', button: ['Свържи се с нас', '/#contact'] },
            { type: 'contact', id: 'contact', alt: true, title: 'Контакт', intro: 'Разкажете ни накратко за задачата.', rows: contactRows('bg', [addr('bg')]), hoursTitle: 'Работно време', hours: week('bg', '9:00 – 18:00', '10:00 – 14:00', 'почивен ден') },
          ] } },
      },
      en: {
        tagline: 'services you can rely on', description: 'What we do, how we work and how to reach us.',
        nav: [['Services', '/#services'], ['Process', '/#process'], ['Reviews', '/#reviews'], ['Contact', '/#contact']], headerCta: ['Get a quote', '/#contact'],
        pages: { index: {
          hero: { eyebrow: 'Taking new clients this month', title: 'We solve your problem <em>fast and fairly</em>', lead: 'Tell us what you need — you get a clear quote within 24 hours, a deadline we keep, and a person who answers the phone.', cta: ['Get a quote', '/#contact'], cta2: ['See services', '/#services'],
            card: { icon: 'shield', title: 'Why clients stay', rows: [['Reply', 'within 24h'], ['Deadlines met', '98%'], ['Warranty', '12 months']], note: 'Sample numbers — replace them with yours.' } },
          sections: [
            { type: 'cards', id: 'services', title: 'What we do', intro: 'The three things we do best. Describe them in your client’s words, not industry jargon.', items: [['spark', 'Consulting', 'We understand the job before we price it. The first call is free.'], ['tools', 'Delivery', 'A clear plan with milestones and progress photos.'], ['shield', 'Support', 'We stay on call after the job — warranty and a fast response.']] },
            { type: 'steps', id: 'process', alt: true, title: 'How we work', intro: 'No surprises: you always know what comes next.', items: [['Talk', 'Tell us what you need — by phone or on site.'], ['Quote', 'Within 24 hours you get a written price and deadline.'], ['Work', 'We deliver and keep you posted.'], ['Handover', 'We check it together and you get a warranty.']] },
            { type: 'stats', items: [['12+', 'years of experience'], ['850', 'projects delivered'], ['4.9/5', 'average rating'], ['24h', 'response time']] },
            { type: 'quotes', id: 'reviews', title: 'What clients say', items: [['“They arrived exactly on time and left everything clean. Recommended.”', 'Maria Petrova, Sofia'], ['“A clear quote with no hidden costs. Already our second order.”', 'George Ivanov, Plovdiv'], ['“Fast replies and a real person on the other end — rare.”', 'Elena Dimitrova, Varna']] },
            { type: 'cta', h: 'Ready to start?', p: 'Write to us today — we answer within one working day.', button: ['Contact us', '/#contact'] },
            { type: 'contact', id: 'contact', alt: true, title: 'Contact', intro: 'Tell us briefly about the job.', rows: contactRows('en', [addr('en')]), hoursTitle: 'Opening hours', hours: week('en', '9:00 – 18:00', '10:00 – 14:00', 'closed') },
          ] } },
      },
    },
  },
  {
    id: 'services', category: 'business', sf: 'wrench.and.screwdriver', mark: 'tools',
    theme: light('#fbfaf7', '#f3efe7', '#ffffff', '#1c1917', '#57534e', '#ea580c', '#f59e0b'),
    lang: {
      bg: {
        tagline: 'ремонти и майсторски услуги', description: 'Ремонти, монтаж и поддръжка на дома и офиса — с ясна цена и гаранция.',
        nav: [['Услуги', '/#services'], ['Цени', '/prices.html'], ['Проекти', '/#projects'], ['Контакт', '/#contact']], headerCta: ['Обади се', TEL],
        pages: {
          index: {
            hero: { eyebrow: 'Идваме още днес в София', eyebrowIcon: 'clock', title: 'Майстори, които <em>идват навреме</em>', lead: 'ВиК, ел. инсталации, боядисване и дребни ремонти. Оглед и оферта без ангажимент, гаранция на всяка работа.', cta: ['Заяви оглед', '/#contact'], cta2: ['Виж цените', '/prices.html'],
              card: { icon: 'tools', title: 'Най-търсени днес', rows: [['Смяна на смесител', 'от 45 лв.'], ['Контакт / ключ', 'от 25 лв.'], ['Боядисване (м²)', 'от 6 лв.']], note: 'Цената е с труд, без материали.' } },
            sections: [
              { type: 'cards', id: 'services', title: 'Услуги', intro: 'Всичко за дома и офиса от един екип.', items: [['tools', 'ВиК', 'Течове, смесители, бойлери, отпушване.'], ['bolt', 'Електро', 'Контакти, осветление, табла, проверка на инсталацията.'], ['home', 'Боядисване', 'Шпакловка, латекс, декоративни покрития.'], ['key', 'Монтаж', 'Мебели, врати, щори, телевизори на стена.']] },
              { type: 'gallery', id: 'projects', alt: true, title: 'Последни проекти', intro: 'Сменете плочките с ваши снимки „преди и след“.', items: ['Баня, Лозенец', 'Кухня, Младост', 'Офис, Център', 'Детска стая, Бояна', 'Тераса, Витоша', 'Антре, Изток'] },
              { type: 'steps', title: 'Как протича', items: [['Обаждане', 'Описвате проблема, уговаряме час.'], ['Оглед', 'Идваме, преценяваме и казваме цената на място.'], ['Ремонт', 'Работим чисто и в срок.'], ['Гаранция', 'Получавате протокол и 12 месеца гаранция.']] },
              { type: 'faq', alt: true, title: 'Чести въпроси', items: [['Колко струва огледът?', 'В рамките на града огледът е безплатен, ако приемете офертата.'], ['Осигурявате ли материали?', 'Да — купуваме ги по ваш избор и прилагаме касовите бележки.'], ['Работите ли в събота?', 'Да, до 14:00. Спешни случаи — и в неделя.']] },
              { type: 'contact', id: 'contact', title: 'Заяви оглед', intro: 'Опишете какво трябва да се направи — връщаме обаждане до час.', rows: contactRows('bg', [addr('bg')]), fields: [{ id: 'service', label: 'Услуга', options: ['ВиК', 'Електро', 'Боядисване', 'Монтаж', 'Друго'] }], messageLabel: 'Какво трябва да се направи', send: 'Изпрати заявка', hoursTitle: 'Работно време', hours: week('bg', '8:00 – 19:00', '9:00 – 14:00', 'само спешни') },
            ] },
          prices: {
            title: 'Цени и услуги', description: 'Ориентировъчни цени за ремонти, монтаж и поддръжка — с включен труд.',
            pagehead: ['Цени', 'Ориентировъчни цени с включен труд. Точната цена казваме след оглед.'],
            sections: [
              { type: 'menu', groups: [
                { name: 'ВиК', items: [['Смяна на смесител', 'Демонтаж и монтаж, без материали', '45 лв.'], ['Отпушване на канал', 'С машина до 10 м', '60 лв.'], ['Монтаж на бойлер', 'До 80 л, със свързване', '90 лв.']] },
                { name: 'Електро', items: [['Контакт или ключ', 'Смяна на съществуващ', '25 лв.'], ['Осветително тяло', 'Монтаж и свързване', '35 лв.'], ['Проверка на инсталация', 'С протокол', '80 лв.']] },
                { name: 'Боядисване', items: [['Латекс, две ръце', 'На м², с покривни материали', '6 лв.'], ['Шпакловка', 'На м², две ръце', '9 лв.']] },
                { name: 'Монтаж', items: [['Телевизор на стена', 'До 65 инча', '50 лв.'], ['Сглобяване на мебел', 'На час', '30 лв.']] },
              ] },
              { type: 'cta', h: 'Не намирате услугата?', p: 'Обадете се — правим и неща, които ги няма в списъка.', button: ['Обади се', TEL] },
            ] },
        },
      },
      en: {
        tagline: 'home repairs and handyman services', description: 'Repairs, installation and maintenance for homes and offices — clear prices and a warranty.',
        nav: [['Services', '/#services'], ['Prices', '/prices.html'], ['Projects', '/#projects'], ['Contact', '/#contact']], headerCta: ['Call us', TEL],
        pages: {
          index: {
            hero: { eyebrow: 'Same-day visits in the city', eyebrowIcon: 'clock', title: 'Handymen who <em>show up on time</em>', lead: 'Plumbing, electrics, painting and small repairs. Free inspection and quote, and a warranty on every job.', cta: ['Book a visit', '/#contact'], cta2: ['See prices', '/prices.html'],
              card: { icon: 'tools', title: 'Most requested today', rows: [['New tap', 'from €25'], ['Socket / switch', 'from €15'], ['Painting (m²)', 'from €3']], note: 'Labour only, materials extra.' } },
            sections: [
              { type: 'cards', id: 'services', title: 'Services', intro: 'Everything for your home and office from one team.', items: [['tools', 'Plumbing', 'Leaks, taps, water heaters, drains.'], ['bolt', 'Electrics', 'Sockets, lighting, panels, safety checks.'], ['home', 'Painting', 'Filling, emulsion, decorative finishes.'], ['key', 'Installation', 'Furniture, doors, blinds, wall-mounted TVs.']] },
              { type: 'gallery', id: 'projects', alt: true, title: 'Recent projects', intro: 'Replace the tiles with your own before-and-after photos.', items: ['Bathroom, Lozenets', 'Kitchen, Mladost', 'Office, City centre', 'Kids room, Boyana', 'Terrace, Vitosha', 'Hallway, Iztok'] },
              { type: 'steps', title: 'How it works', items: [['Call', 'Describe the problem, we book a time.'], ['Inspection', 'We come, assess and price it on the spot.'], ['Repair', 'Clean, on-time work.'], ['Warranty', 'You get a report and a 12-month warranty.']] },
              { type: 'faq', alt: true, title: 'FAQ', items: [['How much is an inspection?', 'Within the city it is free if you accept the quote.'], ['Do you supply materials?', 'Yes — we buy what you choose and hand over the receipts.'], ['Do you work on Saturdays?', 'Yes, until 14:00. Emergencies on Sundays too.']] },
              { type: 'contact', id: 'contact', title: 'Book a visit', intro: 'Tell us what needs doing — we call back within an hour.', rows: contactRows('en', [addr('en')]), fields: [{ id: 'service', label: 'Service', options: ['Plumbing', 'Electrics', 'Painting', 'Installation', 'Other'] }], messageLabel: 'What needs doing', send: 'Send request', hoursTitle: 'Opening hours', hours: week('en', '8:00 – 19:00', '9:00 – 14:00', 'emergencies only') },
            ] },
          prices: {
            title: 'Prices and services', description: 'Guide prices for repairs, installation and maintenance, labour included.',
            pagehead: ['Prices', 'Guide prices, labour included. We confirm the exact price after an inspection.'],
            sections: [
              { type: 'menu', groups: [
                { name: 'Plumbing', items: [['New tap', 'Remove and fit, materials extra', '€25'], ['Drain unblocking', 'Machine, up to 10 m', '€30'], ['Water heater', 'Up to 80 l, connected', '€45']] },
                { name: 'Electrics', items: [['Socket or switch', 'Replace existing', '€15'], ['Light fitting', 'Fit and connect', '€20'], ['Installation check', 'With a report', '€40']] },
                { name: 'Painting', items: [['Emulsion, two coats', 'Per m², covers included', '€3'], ['Filling', 'Per m², two coats', '€5']] },
                { name: 'Installation', items: [['TV wall mount', 'Up to 65 inch', '€25'], ['Furniture assembly', 'Per hour', '€15']] },
              ] },
              { type: 'cta', h: 'Can’t find the service?', p: 'Call us — we do plenty of things that are not on the list.', button: ['Call us', TEL] },
            ] },
        },
      },
    },
  },
  {
    id: 'comingsoon', category: 'business', sf: 'hourglass', mark: 'rocket',
    theme: dark('#0a0a12', '#11111c', '#15152a', '#a855f7', '#ec4899'),
    lang: {
      bg: {
        tagline: 'скоро отваряме', description: 'Нещо ново идва скоро. Оставете имейл и ще ви пишем първи.',
        nav: [['Какво идва', '/#what'], ['Абонирай се', '/#notify']], headerCta: null,
        pages: { index: {
          hero: { center: true, eyebrow: 'Стартираме тази есен', eyebrowIcon: 'rocket', title: 'Нещо ново <em>идва скоро</em>', lead: 'Работим по последните детайли. Оставете имейл — ще ви пишем веднъж, в деня на старта, с отстъпка за първите 100.', cta: ['Искам покана', '/#notify'] },
          sections: [
            { type: 'cards', id: 'what', title: 'Какво да очаквате', items: [['spark', 'Нов подход', 'Едно изречение за това какво ще е различното.'], ['heart', 'Направено с грижа', 'Защо го правите и за кого.'], ['gift', 'Подарък за първите', 'Отстъпка или бонус за абонатите.']] },
            { type: 'form', id: 'notify', alt: true, title: 'Бъдете първи', intro: 'Един имейл в деня на старта. Без спам.', formName: 'notify', button: 'Абонирай ме', note: 'Можете да се отпишете с един клик.' },
          ] } },
      },
      en: {
        tagline: 'launching soon', description: 'Something new is coming soon. Leave your email and hear about it first.',
        nav: [['What’s coming', '/#what'], ['Get notified', '/#notify']], headerCta: null,
        pages: { index: {
          hero: { center: true, eyebrow: 'Launching this autumn', eyebrowIcon: 'rocket', title: 'Something new is <em>coming soon</em>', lead: 'We are polishing the last details. Leave your email — we write once, on launch day, with a discount for the first 100.', cta: ['Get an invite', '/#notify'] },
          sections: [
            { type: 'cards', id: 'what', title: 'What to expect', items: [['spark', 'A fresh approach', 'One sentence on what will be different.'], ['heart', 'Made with care', 'Why you are building it and for whom.'], ['gift', 'A gift for early birds', 'A discount or bonus for subscribers.']] },
            { type: 'form', id: 'notify', alt: true, title: 'Be the first', intro: 'One email on launch day. No spam.', formName: 'notify', button: 'Notify me', note: 'Unsubscribe with one click.' },
          ] } },
      },
    },
  },
  // ------------------------------------------------------------------ food & stay
  {
    id: 'restaurant', category: 'food', sf: 'fork.knife', mark: 'cup',
    theme: light('#faf6ef', '#f3ebdd', '#fffdf9', '#2a1d14', '#6b5a4c', '#b4532a', '#d98a1f', { font: 'sans', head: 'serif', radius: 14, tilt: -1.5 }),
    lang: {
      bg: {
        tagline: 'ресторант и винен бар', description: 'Сезонна кухня, местни продукти и подбрани вина. Резервирайте маса онлайн.',
        nav: [['Меню', '/menu.html'], ['За нас', '/#about'], ['Отзиви', '/#reviews'], ['Резервация', '/#contact']], headerCta: ['Резервирай маса', '/#contact'],
        pages: {
          index: {
            hero: { eyebrow: 'Отворено днес до 23:00', eyebrowIcon: 'clock', title: 'Сезонна кухня, <em>сготвена с време</em>', lead: 'Местни продукти, хляб с квас от нашата фурна и вино от малки изби. Маса за двама или празник за двайсет.', cta: ['Резервирай маса', '/#contact'], cta2: ['Виж менюто', '/menu.html'],
              card: { icon: 'cup', title: 'Днес препоръчваме', rows: [['Крем супа от тиква', '9 лв.'], ['Агнешко с розмарин', '28 лв.'], ['Шоколадов фондан', '12 лв.']], note: 'Менюто на деня се сменя всяка сутрин.' } },
            sections: [
              { type: 'cards', id: 'about', title: 'Нашата кухня', intro: 'Малко меню, което се сменя със сезона — защото вкусът е в продукта.', items: [['leaf', 'Местни продукти', 'Зеленчуци от ферми до 80 км и месо от проверени стопанства.'], ['cup', 'Подбрани вина', 'Над 60 етикета от малки български изби.'], ['users', 'Събития', 'Рождени дни, фирмени вечери и дегустации до 40 гости.']] },
              { type: 'gallery', alt: true, title: 'Атмосфера', intro: 'Сменете плочките със снимки на салона, ястията и екипа.', items: ['Салонът', 'Лятната градина', 'Кухнята', 'Винената изба'] },
              { type: 'quotes', id: 'reviews', title: 'Гостите казват', items: [['„Най-доброто агнешко в града и обслужване, което те кара да се върнеш.“', 'Ивайло, Google'], ['„Винената листа е чудесна, а персоналът знае какво препоръчва.“', 'Надя, TripAdvisor'], ['„Празнувахме рожден ден — всичко беше перфектно.“', 'Симона, Facebook']] },
              { type: 'contact', id: 'contact', alt: true, title: 'Резервация', intro: 'За групи над 8 души се обадете по телефона.', formName: 'reservation', rows: contactRows('bg', [addr('bg')]), fields: [{ id: 'date', label: 'Дата', type: 'date' }, { id: 'guests', label: 'Брой гости', options: ['2', '3', '4', '5', '6', '7', '8'] }], messageLabel: 'Пожелания (по избор)', send: 'Изпрати резервация', hoursTitle: 'Работно време', hours: week('bg', '12:00 – 23:00', '12:00 – 24:00', '12:00 – 22:00') },
            ] },
          menu: {
            title: 'Меню и цени', description: 'Сезонното меню на ресторанта: предястия, основни ястия, десерти и вино.',
            pagehead: ['Меню', 'Сезонно меню. Попитайте за алергени — ще ви насочим.'],
            sections: [
              { type: 'menu', groups: [
                { name: 'Предястия', items: [['Хляб с квас и масло', 'Печен сутринта', '5 лв.'], ['Салата с печена цвекла', 'Козе сирене, орехи, мед', '14 лв.'], ['Крем супа от тиква', 'Тиквени семки, сметана', '9 лв.']] },
                { name: 'Основни', items: [['Агнешко с розмарин', 'Бавно печено, картофи', '28 лв.'], ['Ризото с гъби', 'Манатарки, пармезан', '22 лв.'], ['Филе от пъстърва', 'Масло с лимон, зеленчуци', '24 лв.']] },
                { name: 'Десерти', items: [['Шоколадов фондан', 'Ванилов сладолед', '12 лв.'], ['Тиквеник по нашему', 'Канела, орехи', '9 лв.']] },
                { name: 'Вино', items: [['Мавруд, чаша', 'Пловдивски регион', '9 лв.'], ['Тамянка, чаша', 'Южна Черноморка', '8 лв.'], ['Бутилка на деня', 'Попитайте сервитьора', '38 лв.']] },
              ] },
              { type: 'cta', h: 'Запазете маса', p: 'Петък и събота вечер са пълни — резервирайте предварително.', button: ['Резервирай', '/#contact'] },
            ] },
        },
      },
      en: {
        tagline: 'restaurant and wine bar', description: 'Seasonal cooking, local produce and hand-picked wines. Book a table online.',
        nav: [['Menu', '/menu.html'], ['About', '/#about'], ['Reviews', '/#reviews'], ['Book', '/#contact']], headerCta: ['Book a table', '/#contact'],
        pages: {
          index: {
            hero: { eyebrow: 'Open today until 23:00', eyebrowIcon: 'clock', title: 'Seasonal cooking, <em>made with time</em>', lead: 'Local produce, sourdough from our own oven and wine from small wineries. A table for two or a party for twenty.', cta: ['Book a table', '/#contact'], cta2: ['See the menu', '/menu.html'],
              card: { icon: 'cup', title: 'Today we recommend', rows: [['Pumpkin soup', '€5'], ['Rosemary lamb', '€14'], ['Chocolate fondant', '€6']], note: 'The daily menu changes every morning.' } },
            sections: [
              { type: 'cards', id: 'about', title: 'Our kitchen', intro: 'A short menu that changes with the season — because flavour starts with the produce.', items: [['leaf', 'Local produce', 'Vegetables from farms within 80 km and meat from farms we know.'], ['cup', 'Hand-picked wine', 'Over 60 labels from small wineries.'], ['users', 'Events', 'Birthdays, company dinners and tastings for up to 40 guests.']] },
              { type: 'gallery', alt: true, title: 'Atmosphere', intro: 'Replace the tiles with photos of the room, the food and the team.', items: ['The dining room', 'Summer garden', 'The kitchen', 'Wine cellar'] },
              { type: 'quotes', id: 'reviews', title: 'Guests say', items: [['“The best lamb in town and service that makes you come back.”', 'Ivaylo, Google'], ['“A wonderful wine list, and the staff know what to recommend.”', 'Nadia, TripAdvisor'], ['“We celebrated a birthday — everything was perfect.”', 'Simona, Facebook']] },
              { type: 'contact', id: 'contact', alt: true, title: 'Book a table', intro: 'For groups over 8 please call us.', formName: 'reservation', rows: contactRows('en', [addr('en')]), fields: [{ id: 'date', label: 'Date', type: 'date' }, { id: 'guests', label: 'Guests', options: ['2', '3', '4', '5', '6', '7', '8'] }], messageLabel: 'Requests (optional)', send: 'Send booking', hoursTitle: 'Opening hours', hours: week('en', '12:00 – 23:00', '12:00 – 24:00', '12:00 – 22:00') },
            ] },
          menu: {
            title: 'Menu and prices', description: 'The seasonal menu: starters, mains, desserts and wine.',
            pagehead: ['Menu', 'Seasonal menu. Ask us about allergens — we are happy to help.'],
            sections: [
              { type: 'menu', groups: [
                { name: 'Starters', items: [['Sourdough and butter', 'Baked this morning', '€3'], ['Roast beetroot salad', 'Goat cheese, walnuts, honey', '€7'], ['Pumpkin soup', 'Pumpkin seeds, cream', '€5']] },
                { name: 'Mains', items: [['Rosemary lamb', 'Slow-roasted, potatoes', '€14'], ['Mushroom risotto', 'Porcini, parmesan', '€11'], ['Trout fillet', 'Lemon butter, vegetables', '€12']] },
                { name: 'Desserts', items: [['Chocolate fondant', 'Vanilla ice cream', '€6'], ['Pumpkin pie our way', 'Cinnamon, walnuts', '€5']] },
                { name: 'Wine', items: [['Mavrud, glass', 'Plovdiv region', '€5'], ['Tamyanka, glass', 'Southern Black Sea', '€4'], ['Bottle of the day', 'Ask your waiter', '€19']] },
              ] },
              { type: 'cta', h: 'Save a table', p: 'Friday and Saturday evenings fill up — book ahead.', button: ['Book', '/#contact'] },
            ] },
        },
      },
    },
  },
  {
    id: 'hotel', category: 'food', sf: 'bed.double', mark: 'bed',
    theme: light('#f7f5f0', '#eeebe3', '#ffffff', '#1f2a28', '#5d6966', '#0f766e', '#14b8a6', { head: 'serif', radius: 16 }),
    lang: {
      bg: {
        tagline: 'къща за гости в планината', description: 'Уютни стаи, домашна закуска и гледка към планината. Резервирайте директно — най-добра цена.',
        nav: [['Стаи', '/rooms.html'], ['Удобства', '/#amenities'], ['Отзиви', '/#reviews'], ['Контакт', '/#contact']], headerCta: ['Провери наличност', '/#contact'],
        pages: {
          index: {
            hero: { eyebrow: 'Директна резервация = най-добра цена', eyebrowIcon: 'star', title: 'Тишина, гора и <em>закуска с изглед</em>', lead: 'Осем стаи в сърцето на планината, на 10 минути от ски пистите и на две крачки от горските пътеки.', cta: ['Провери наличност', '/#contact'], cta2: ['Разгледай стаите', '/rooms.html'],
              card: { icon: 'bed', title: 'Свободни този уикенд', rows: [['Двойна стая', 'от 120 лв.'], ['Семеен апартамент', 'от 190 лв.'], ['Студио с камина', 'от 160 лв.']], note: 'Цената е за нощувка със закуска.' } },
            sections: [
              { type: 'cards', id: 'amenities', title: 'Удобства', items: [['cup', 'Домашна закуска', 'Баница, мед от съседа и прясно кафе до 10:30.'], ['leaf', 'СПА и сауна', 'Финландска сауна и джакузи с гледка.'], ['pin', 'Паркинг и Wi-Fi', 'Безплатни за всички гости.'], ['heart', 'Домашни любимци', 'Добре дошли в избрани стаи.']] },
              { type: 'gallery', alt: true, title: 'Галерия', intro: 'Заменете плочките с ваши снимки — стаите, двора, гледката.', items: ['Гледка от терасата', 'Двойна стая', 'Трапезарията', 'Сауната', 'Градината', 'Зимата при нас'] },
              { type: 'quotes', id: 'reviews', title: 'Гостите за нас', items: [['„Най-тихото място, на което сме спали. Закуската е легенда.“', 'Петя и Иван, Booking'], ['„Чисто, топло, домакините са невероятни хора.“', 'Даниел, Google'], ['„Ще се върнем с децата през лятото.“', 'Росица, Facebook']] },
              { type: 'contact', id: 'contact', title: 'Проверка на наличност', intro: 'Пишете дати и брой гости — отговаряме до 2 часа.', formName: 'booking', rows: contactRows('bg', [['pin', 'Адрес', 'с. Примерно, общ. Банско']]), fields: [{ id: 'checkin', label: 'Настаняване', type: 'date' }, { id: 'checkout', label: 'Напускане', type: 'date' }, { id: 'guests', label: 'Гости', options: ['1', '2', '3', '4', '5+'] }], messageLabel: 'Пожелания', send: 'Провери наличност' },
            ] },
          rooms: {
            title: 'Стаи и цени', description: 'Двойни стаи, студия и семейни апартаменти с цени за нощувка със закуска.',
            pagehead: ['Стаи и цени', 'Всички стаи са с баня, закуска и достъп до СПА зоната.'],
            sections: [
              { type: 'pricing', items: [
                { name: 'Двойна стая', price: '120 лв.', per: '/ нощ', features: ['До 2 гости', 'Балкон с изглед', 'Закуска включена'], cta: ['Запитване', '/#contact'] },
                { name: 'Студио с камина', price: '160 лв.', per: '/ нощ', featured: 'Най-търсено', features: ['До 2 гости', 'Камина и кът за сядане', 'Закуска и СПА'], cta: ['Запитване', '/#contact'] },
                { name: 'Семеен апартамент', price: '190 лв.', per: '/ нощ', features: ['До 4 гости', 'Две спални', 'Кухненски бокс'], cta: ['Запитване', '/#contact'] },
              ] },
              { type: 'faq', alt: true, title: 'Условия', items: [['Кога е настаняването?', 'От 14:00, напускане до 11:00. При възможност — гъвкаво.'], ['Какво е капарото?', '30% при потвърждение, остатъкът — на място.'], ['Мога ли да откажа?', 'Безплатно до 7 дни преди пристигане.']] },
            ] },
        },
      },
      en: {
        tagline: 'mountain guesthouse', description: 'Cosy rooms, homemade breakfast and mountain views. Book direct for the best rate.',
        nav: [['Rooms', '/rooms.html'], ['Amenities', '/#amenities'], ['Reviews', '/#reviews'], ['Contact', '/#contact']], headerCta: ['Check availability', '/#contact'],
        pages: {
          index: {
            hero: { eyebrow: 'Book direct for the best rate', eyebrowIcon: 'star', title: 'Quiet, forest and <em>breakfast with a view</em>', lead: 'Eight rooms in the heart of the mountains, ten minutes from the ski slopes and steps from the forest trails.', cta: ['Check availability', '/#contact'], cta2: ['See the rooms', '/rooms.html'],
              card: { icon: 'bed', title: 'Free this weekend', rows: [['Double room', 'from €60'], ['Family suite', 'from €95'], ['Studio with fireplace', 'from €80']], note: 'Per night, breakfast included.' } },
            sections: [
              { type: 'cards', id: 'amenities', title: 'Amenities', items: [['cup', 'Homemade breakfast', 'Fresh pastry, local honey and coffee until 10:30.'], ['leaf', 'Spa and sauna', 'Finnish sauna and a hot tub with a view.'], ['pin', 'Parking and Wi-Fi', 'Free for every guest.'], ['heart', 'Pets welcome', 'In selected rooms.']] },
              { type: 'gallery', alt: true, title: 'Gallery', intro: 'Replace the tiles with your photos — rooms, garden, the view.', items: ['View from the terrace', 'Double room', 'Dining room', 'The sauna', 'The garden', 'Winter with us'] },
              { type: 'quotes', id: 'reviews', title: 'Guests about us', items: [['“The quietest place we have ever slept. Breakfast is legendary.”', 'Petya & Ivan, Booking'], ['“Clean, warm, and the hosts are wonderful people.”', 'Daniel, Google'], ['“We will be back with the kids in summer.”', 'Rositsa, Facebook']] },
              { type: 'contact', id: 'contact', title: 'Check availability', intro: 'Send your dates and number of guests — we reply within 2 hours.', formName: 'booking', rows: contactRows('en', [['pin', 'Address', 'Primerno village, Bansko']]), fields: [{ id: 'checkin', label: 'Check-in', type: 'date' }, { id: 'checkout', label: 'Check-out', type: 'date' }, { id: 'guests', label: 'Guests', options: ['1', '2', '3', '4', '5+'] }], messageLabel: 'Requests', send: 'Check availability' },
            ] },
          rooms: {
            title: 'Rooms and rates', description: 'Double rooms, studios and family suites with nightly rates including breakfast.',
            pagehead: ['Rooms and rates', 'Every room has a private bathroom, breakfast and spa access.'],
            sections: [
              { type: 'pricing', items: [
                { name: 'Double room', price: '€60', per: '/ night', features: ['Up to 2 guests', 'Balcony with a view', 'Breakfast included'], cta: ['Enquire', '/#contact'] },
                { name: 'Studio with fireplace', price: '€80', per: '/ night', featured: 'Most booked', features: ['Up to 2 guests', 'Fireplace and lounge', 'Breakfast and spa'], cta: ['Enquire', '/#contact'] },
                { name: 'Family suite', price: '€95', per: '/ night', features: ['Up to 4 guests', 'Two bedrooms', 'Kitchenette'], cta: ['Enquire', '/#contact'] },
              ] },
              { type: 'faq', alt: true, title: 'Policies', items: [['When is check-in?', 'From 14:00, check-out by 11:00. Flexible when we can.'], ['Is there a deposit?', '30% on confirmation, the rest on arrival.'], ['Can I cancel?', 'Free up to 7 days before arrival.']] },
            ] },
        },
      },
    },
  },
  // ------------------------------------------------------------------ beauty & health
  {
    id: 'salon', category: 'beauty', sf: 'scissors', mark: 'scissors',
    theme: light('#fdf7f6', '#f8ecea', '#ffffff', '#2d1b22', '#6e5660', '#c0265e', '#e879a6', { head: 'serif', radius: 20, tilt: 2 }),
    lang: {
      bg: {
        tagline: 'салон за красота', description: 'Фризьорство, маникюр, козметика и грим. Запазете час онлайн за минута.',
        nav: [['Услуги', '/#services'], ['Цени', '/prices.html'], ['Екип', '/#team'], ['Час', '/#contact']], headerCta: ['Запази час', '/#contact'],
        pages: {
          index: {
            hero: { eyebrow: 'Свободни часове този четвъртък', eyebrowIcon: 'calendar', title: 'Време само <em>за вас</em>', lead: 'Подстригване, цвят, маникюр и грижа за лицето в спокойна обстановка — с продукти, които обичаме и на които вярваме.', cta: ['Запази час', '/#contact'], cta2: ['Цени', '/prices.html'],
              card: { icon: 'calendar', title: 'Свободни часове', rows: [['Чт, 11:00', 'Подстригване'], ['Чт, 14:30', 'Маникюр'], ['Пт, 10:00', 'Боядисване']], note: 'Потвърждаваме с SMS.' } },
            sections: [
              { type: 'cards', id: 'services', title: 'Услуги', items: [['scissors', 'Коса', 'Подстригване, боядисване, балеаж, прически за поводи.'], ['hand', 'Маникюр и педикюр', 'Класически, гел лак, ноктопластика.'], ['leaf', 'Козметика', 'Почистване на лице, масажи, терапии против стареене.'], ['star', 'Грим', 'Дневен, вечерен и булчински — с проба.']] },
              { type: 'cards', id: 'team', alt: true, title: 'Екипът', intro: 'Сменете с имената и снимките на екипа — клиентите избират човек, не салон.', items: [['heart', 'Ива — стилист', '14 години опит, специалист по цвят и балеаж.'], ['hand', 'Деси — маникюрист', 'Прецизност и търпение за най-сложните дизайни.'], ['leaf', 'Мира — козметик', 'Сертифицирана в терапии за чувствителна кожа.']] },
              { type: 'quotes', title: 'Отзиви', items: [['„Най-после някой, който разбира какво искам с косата си!“', 'Кристина'], ['„Маникюрът издържа три седмици. Връщам се всеки месец.“', 'Весела'], ['„Спокойна атмосфера и страхотен екип.“', 'Анелия']] },
              { type: 'contact', id: 'contact', alt: true, title: 'Запази час', intro: 'Изберете услуга и удобен ден — ще потвърдим с обаждане или SMS.', formName: 'booking', rows: contactRows('bg', [addr('bg')]), fields: [{ id: 'service', label: 'Услуга', options: ['Подстригване', 'Боядисване', 'Маникюр', 'Педикюр', 'Лице', 'Грим'] }, { id: 'date', label: 'Желан ден', type: 'date' }], messageLabel: 'Бележка (по избор)', send: 'Запази час', hoursTitle: 'Работно време', hours: week('bg', '9:00 – 20:00', '9:00 – 16:00', 'почивен ден') },
            ] },
          prices: {
            title: 'Цени на услугите', description: 'Цени за подстригване, боядисване, маникюр, козметика и грим.',
            pagehead: ['Цени', 'Цените зависят от дължината на косата и продуктите — ще ги потвърдим на място.'],
            sections: [
              { type: 'menu', groups: [
                { name: 'Коса', items: [['Дамско подстригване', 'С измиване и сешоар', '45 лв.'], ['Мъжко подстригване', '', '25 лв.'], ['Боядисване', 'Един тон, средна коса', 'от 70 лв.'], ['Балеаж', 'С тониране', 'от 150 лв.']] },
                { name: 'Ръце и крака', items: [['Маникюр с гел лак', '', '40 лв.'], ['Педикюр', 'Класически', '45 лв.'], ['Ноктопластика', 'Изграждане', '65 лв.']] },
                { name: 'Лице', items: [['Почистване на лице', '60 мин.', '70 лв.'], ['Масаж на лице', '30 мин.', '40 лв.']] },
                { name: 'Грим', items: [['Вечерен грим', '', '60 лв.'], ['Булчински грим', 'С проба', '150 лв.']] },
              ] },
              { type: 'cta', h: 'Подаръчни ваучери', p: 'Подарете време за красота — ваучери на всякаква стойност.', button: ['Попитай за ваучер', '/#contact'] },
            ] },
        },
      },
      en: {
        tagline: 'beauty salon', description: 'Hair, nails, skin care and make-up. Book an appointment online in a minute.',
        nav: [['Services', '/#services'], ['Prices', '/prices.html'], ['Team', '/#team'], ['Book', '/#contact']], headerCta: ['Book now', '/#contact'],
        pages: {
          index: {
            hero: { eyebrow: 'Free slots this Thursday', eyebrowIcon: 'calendar', title: 'Time just <em>for you</em>', lead: 'Cuts, colour, nails and skin care in a calm space — with products we love and trust.', cta: ['Book now', '/#contact'], cta2: ['Prices', '/prices.html'],
              card: { icon: 'calendar', title: 'Free slots', rows: [['Thu, 11:00', 'Haircut'], ['Thu, 14:30', 'Manicure'], ['Fri, 10:00', 'Colour']], note: 'We confirm by text message.' } },
            sections: [
              { type: 'cards', id: 'services', title: 'Services', items: [['scissors', 'Hair', 'Cuts, colour, balayage, occasion styling.'], ['hand', 'Nails', 'Classic, gel polish, extensions.'], ['leaf', 'Skin care', 'Facials, massage, anti-ageing treatments.'], ['star', 'Make-up', 'Day, evening and bridal — with a trial.']] },
              { type: 'cards', id: 'team', alt: true, title: 'The team', intro: 'Replace with your team’s names and photos — clients choose a person, not a salon.', items: [['heart', 'Iva — stylist', '14 years of experience, colour and balayage specialist.'], ['hand', 'Desi — nail artist', 'Precision and patience for the most detailed designs.'], ['leaf', 'Mira — beautician', 'Certified in treatments for sensitive skin.']] },
              { type: 'quotes', title: 'Reviews', items: [['“Finally someone who understands what I want with my hair!”', 'Kristina'], ['“My manicure lasted three weeks. I come back every month.”', 'Vesela'], ['“A calm atmosphere and a wonderful team.”', 'Aneliya']] },
              { type: 'contact', id: 'contact', alt: true, title: 'Book an appointment', intro: 'Pick a service and a day — we confirm by phone or text.', formName: 'booking', rows: contactRows('en', [addr('en')]), fields: [{ id: 'service', label: 'Service', options: ['Haircut', 'Colour', 'Manicure', 'Pedicure', 'Facial', 'Make-up'] }, { id: 'date', label: 'Preferred day', type: 'date' }], messageLabel: 'Note (optional)', send: 'Book now', hoursTitle: 'Opening hours', hours: week('en', '9:00 – 20:00', '9:00 – 16:00', 'closed') },
            ] },
          prices: {
            title: 'Prices and treatments', description: 'Prices for haircuts, colour, nails, facials and make-up.',
            pagehead: ['Prices', 'Prices depend on hair length and products — we confirm them in the salon.'],
            sections: [
              { type: 'menu', groups: [
                { name: 'Hair', items: [['Women’s cut', 'Wash and blow-dry', '€23'], ['Men’s cut', '', '€13'], ['Colour', 'One tone, medium hair', 'from €35'], ['Balayage', 'With toner', 'from €75']] },
                { name: 'Nails', items: [['Gel manicure', '', '€20'], ['Pedicure', 'Classic', '€23'], ['Nail extensions', 'Full set', '€33']] },
                { name: 'Skin', items: [['Deep-cleansing facial', '60 min', '€35'], ['Facial massage', '30 min', '€20']] },
                { name: 'Make-up', items: [['Evening make-up', '', '€30'], ['Bridal make-up', 'With a trial', '€75']] },
              ] },
              { type: 'cta', h: 'Gift vouchers', p: 'Give the gift of time — vouchers for any amount.', button: ['Ask about vouchers', '/#contact'] },
            ] },
        },
      },
    },
  },
  {
    id: 'clinic', category: 'beauty', sf: 'cross.case', mark: 'tooth',
    theme: light('#f6fafd', '#eaf3f9', '#ffffff', '#0f2436', '#4f6475', '#0284c7', '#06b6d4', { font: 'rounded', radius: 18 }),
    lang: {
      bg: {
        tagline: 'дентален и медицински център', description: 'Профилактика, лечение и естетика с модерна апаратура. Запишете час онлайн.',
        nav: [['Услуги', '/#services'], ['Лекари', '/team.html'], ['Въпроси', '/#faq'], ['Час', '/#contact']], headerCta: ['Запиши час', '/#contact'],
        pages: {
          index: {
            hero: { eyebrow: 'Приемаме нови пациенти', eyebrowIcon: 'shield', title: 'Грижа, която <em>не боли</em>', lead: 'Профилактика, лечение и естетична дентална медицина с внимание към всеки детайл — и към вашето спокойствие.', cta: ['Запиши час', '/#contact'], cta2: ['Нашите лекари', '/team.html'],
              card: { icon: 'calendar', title: 'Най-близки свободни часове', rows: [['Утре, 9:30', 'Преглед'], ['Утре, 15:00', 'Почистване'], ['Петък, 11:00', 'Консултация']], note: 'Работим с НЗОК и частни фондове.' } },
            sections: [
              { type: 'cards', id: 'services', title: 'Услуги', items: [['shield', 'Профилактика', 'Преглед, почистване на зъбен камък, полиране.'], ['tooth', 'Лечение', 'Пломби, ендодонтия, лечение на венци.'], ['star', 'Естетика', 'Избелване, фасети, невидими шини.'], ['users', 'Детска дентална медицина', 'Спокоен първи преглед и профилактика за децата.']] },
              { type: 'stats', alt: true, items: [['15 000+', 'доволни пациенти'], ['9', 'специалисти'], ['1 ден', 'до първи преглед'], ['0 лв.', 'консултация за деца']] },
              { type: 'faq', id: 'faq', title: 'Чести въпроси', items: [['Работите ли с НЗОК?', 'Да — за прегледи и част от лечението. Кажете ни при записване.'], ['Боли ли?', 'Използваме съвременна локална анестезия. Повечето процедури са напълно безболезнени.'], ['Може ли на изплащане?', 'Да, за лечения над 500 лв. — без оскъпяване.']] },
              { type: 'contact', id: 'contact', alt: true, title: 'Запиши час', intro: 'Ще ви се обадим, за да потвърдим часа.', formName: 'appointment', rows: contactRows('bg', [addr('bg')]), fields: [{ id: 'phone', label: 'Телефон', type: 'tel' }, { id: 'reason', label: 'Повод', options: ['Преглед', 'Болка', 'Почистване', 'Естетика', 'Друго'] }], messageLabel: 'Кратко описание (по избор)', send: 'Запиши час', hoursTitle: 'Работно време', hours: week('bg', '8:00 – 20:00', '9:00 – 14:00', 'затворено') },
            ] },
          team: {
            title: 'Нашите лекари', description: 'Запознайте се с лекарите и специалистите в центъра.',
            pagehead: ['Нашите лекари', 'Специалисти с дългогодишен опит и постоянно обучение.'],
            sections: [
              { type: 'cards', items: [['tooth', 'Д-р Анна Николова', 'Главен лекар, естетична дентална медицина. 18 години опит.'], ['shield', 'Д-р Петър Стоянов', 'Ендодонтия и микроскопско лечение на канали.'], ['users', 'Д-р Елица Василева', 'Детска дентална медицина — търпение и усмивки.'], ['star', 'Д-р Мартин Колев', 'Имплантология и хирургия.']] },
              { type: 'cta', h: 'Първи преглед?', p: 'Запишете се — ще ви разкажем за плана и цената, преди да започнем.', button: ['Запиши час', '/#contact'] },
            ] },
        },
      },
      en: {
        tagline: 'dental and medical centre', description: 'Prevention, treatment and aesthetics with modern equipment. Book online.',
        nav: [['Services', '/#services'], ['Doctors', '/team.html'], ['FAQ', '/#faq'], ['Book', '/#contact']], headerCta: ['Book a visit', '/#contact'],
        pages: {
          index: {
            hero: { eyebrow: 'Accepting new patients', eyebrowIcon: 'shield', title: 'Care that <em>doesn’t hurt</em>', lead: 'Prevention, treatment and cosmetic dentistry with attention to every detail — and to your peace of mind.', cta: ['Book a visit', '/#contact'], cta2: ['Our doctors', '/team.html'],
              card: { icon: 'calendar', title: 'Next free slots', rows: [['Tomorrow, 9:30', 'Check-up'], ['Tomorrow, 15:00', 'Cleaning'], ['Friday, 11:00', 'Consultation']], note: 'We work with major insurers.' } },
            sections: [
              { type: 'cards', id: 'services', title: 'Services', items: [['shield', 'Prevention', 'Check-up, scaling and polishing.'], ['tooth', 'Treatment', 'Fillings, root canals, gum treatment.'], ['star', 'Aesthetics', 'Whitening, veneers, clear aligners.'], ['users', 'Children’s dentistry', 'A calm first visit and prevention for kids.']] },
              { type: 'stats', alt: true, items: [['15,000+', 'happy patients'], ['9', 'specialists'], ['1 day', 'to your first visit'], ['Free', 'consultation for kids']] },
              { type: 'faq', id: 'faq', title: 'FAQ', items: [['Do you accept insurance?', 'Yes — for check-ups and much of the treatment. Tell us when you book.'], ['Will it hurt?', 'We use modern local anaesthesia. Most procedures are completely painless.'], ['Can I pay in instalments?', 'Yes, for treatment over €250 — at no extra cost.']] },
              { type: 'contact', id: 'contact', alt: true, title: 'Book a visit', intro: 'We will call you to confirm the time.', formName: 'appointment', rows: contactRows('en', [addr('en')]), fields: [{ id: 'phone', label: 'Phone', type: 'tel' }, { id: 'reason', label: 'Reason', options: ['Check-up', 'Pain', 'Cleaning', 'Aesthetics', 'Other'] }], messageLabel: 'Short description (optional)', send: 'Book a visit', hoursTitle: 'Opening hours', hours: week('en', '8:00 – 20:00', '9:00 – 14:00', 'closed') },
            ] },
          team: {
            title: 'Our doctors', description: 'Meet the doctors and specialists at the centre.',
            pagehead: ['Our doctors', 'Specialists with years of experience and ongoing training.'],
            sections: [
              { type: 'cards', items: [['tooth', 'Dr Anna Nikolova', 'Head doctor, cosmetic dentistry. 18 years of experience.'], ['shield', 'Dr Peter Stoyanov', 'Endodontics and microscope root-canal treatment.'], ['users', 'Dr Elitsa Vasileva', 'Children’s dentistry — patience and smiles.'], ['star', 'Dr Martin Kolev', 'Implants and oral surgery.']] },
              { type: 'cta', h: 'First visit?', p: 'Book now — we explain the plan and the price before we start.', button: ['Book a visit', '/#contact'] },
            ] },
        },
      },
    },
  },
  {
    id: 'fitness', category: 'beauty', sf: 'figure.run', mark: 'bolt',
    theme: dark('#0c0d0c', '#131513', '#181b18', '#a3e635', '#22c55e', { onAccent: '#0c0d0c', radius: 14, font: 'sans' }),
    lang: {
      bg: {
        tagline: 'фитнес и персонални тренировки', description: 'Групови и персонални тренировки, хранителни планове и първа тренировка безплатно.',
        nav: [['Програми', '/#programs'], ['График', '/#schedule'], ['Карти', '/#plans'], ['Контакт', '/#contact']], headerCta: ['Безплатна тренировка', '/#contact'],
        pages: { index: {
          hero: { eyebrow: 'Първата тренировка е безплатна', eyebrowIcon: 'bolt', title: 'По-силен <em>всяка седмица</em>', lead: 'Персонални и групови тренировки с треньори, които следят напредъка ви — и хранителен план, който се спазва лесно.', cta: ['Запиши се', '/#contact'], cta2: ['Виж картите', '/#plans'],
            card: { icon: 'chart', title: 'Напредък за 12 седмици', rows: [['Сила', '+32%'], ['Издръжливост', '+45%'], ['Тренировки', '36 от 36']], note: 'Примерен резултат от програма „Старт“.' } },
          sections: [
            { type: 'cards', id: 'programs', title: 'Програми', items: [['bolt', 'Сила', 'Основни движения, правилна техника, реален прогрес.'], ['heart', 'Кардио и HIIT', 'Кратки, интензивни тренировки за издръжливост.'], ['users', 'Групови', 'Мотивация в малки групи до 10 души.'], ['leaf', 'Хранене', 'План, съобразен с вкуса и графика ви.']] },
            { type: 'timeline', id: 'schedule', alt: true, title: 'Седмичен график', items: [['Пон, Ср, Пет · 7:00', 'Сила — сутрешна група', 'Основни упражнения с щанга и дъмбели.'], ['Вт, Чет · 18:30', 'HIIT', '40 минути, които горят.'], ['Събота · 10:00', 'Мобилност и стречинг', 'Възстановяване за цялата седмица.']] },
            { type: 'pricing', id: 'plans', title: 'Карти', items: [
              { name: 'Месечна', price: '70 лв.', per: '/ месец', features: ['Неограничен достъп', 'Групови тренировки', 'Начален фитнес тест'], cta: ['Избери', '/#contact'] },
              { name: 'Персонална', price: '240 лв.', per: '/ 8 трен.', featured: 'Най-бърз резултат', features: ['Треньор само за вас', 'Хранителен план', 'Седмично проследяване'], cta: ['Избери', '/#contact'] },
              { name: 'Годишна', price: '690 лв.', per: '/ година', features: ['Два месеца подарък', 'Замразяване до 30 дни', 'Карта за гост'], cta: ['Избери', '/#contact'] },
            ] },
            { type: 'contact', id: 'contact', alt: true, title: 'Запиши безплатна тренировка', intro: 'Кажете ни целта си — ще подберем треньор и час.', formName: 'trial', rows: contactRows('bg', [addr('bg')]), fields: [{ id: 'goal', label: 'Цел', options: ['Отслабване', 'Сила', 'Издръжливост', 'Здраве и стойка'] }], messageLabel: 'Нещо, което да знаем (по избор)', send: 'Запиши ме', hoursTitle: 'Работно време', hours: week('bg', '6:30 – 22:00', '8:00 – 20:00', '9:00 – 18:00') },
          ] } },
      },
      en: {
        tagline: 'gym and personal training', description: 'Group and personal training, nutrition plans and a free first session.',
        nav: [['Programs', '/#programs'], ['Schedule', '/#schedule'], ['Memberships', '/#plans'], ['Contact', '/#contact']], headerCta: ['Free session', '/#contact'],
        pages: { index: {
          hero: { eyebrow: 'Your first session is free', eyebrowIcon: 'bolt', title: 'Stronger <em>every week</em>', lead: 'Personal and group training with coaches who track your progress — plus a nutrition plan that is easy to stick to.', cta: ['Join now', '/#contact'], cta2: ['See memberships', '/#plans'],
            card: { icon: 'chart', title: 'Progress in 12 weeks', rows: [['Strength', '+32%'], ['Endurance', '+45%'], ['Sessions', '36 of 36']], note: 'Sample result from the “Start” program.' } },
          sections: [
            { type: 'cards', id: 'programs', title: 'Programs', items: [['bolt', 'Strength', 'Core lifts, proper technique, real progress.'], ['heart', 'Cardio and HIIT', 'Short, intense sessions for endurance.'], ['users', 'Small groups', 'Motivation in groups of up to 10.'], ['leaf', 'Nutrition', 'A plan that fits your taste and schedule.']] },
            { type: 'timeline', id: 'schedule', alt: true, title: 'Weekly schedule', items: [['Mon, Wed, Fri · 7:00', 'Strength — morning group', 'Barbell and dumbbell fundamentals.'], ['Tue, Thu · 18:30', 'HIIT', '40 minutes that burn.'], ['Saturday · 10:00', 'Mobility and stretching', 'Recovery for the whole week.']] },
            { type: 'pricing', id: 'plans', title: 'Memberships', items: [
              { name: 'Monthly', price: '€35', per: '/ month', features: ['Unlimited access', 'Group classes', 'Starting fitness test'], cta: ['Choose', '/#contact'] },
              { name: 'Personal', price: '€120', per: '/ 8 sessions', featured: 'Fastest results', features: ['A coach just for you', 'Nutrition plan', 'Weekly check-ins'], cta: ['Choose', '/#contact'] },
              { name: 'Yearly', price: '€345', per: '/ year', features: ['Two months free', 'Freeze up to 30 days', 'Guest pass'], cta: ['Choose', '/#contact'] },
            ] },
            { type: 'contact', id: 'contact', alt: true, title: 'Book a free session', intro: 'Tell us your goal — we match you with a coach and a time.', formName: 'trial', rows: contactRows('en', [addr('en')]), fields: [{ id: 'goal', label: 'Goal', options: ['Lose weight', 'Strength', 'Endurance', 'Health and posture'] }], messageLabel: 'Anything we should know (optional)', send: 'Book me in', hoursTitle: 'Opening hours', hours: week('en', '6:30 – 22:00', '8:00 – 20:00', '9:00 – 18:00') },
          ] } },
      },
    },
  },
  // ------------------------------------------------------------------ shop & property
  {
    id: 'shop', category: 'commerce', sf: 'bag', mark: 'bag',
    theme: light('#fbfaf9', '#f3f0fa', '#ffffff', '#1d1530', '#5f5873', '#7c3aed', '#db2777', { font: 'rounded', radius: 20 }),
    lang: {
      bg: {
        tagline: 'ръчно изработени неща с характер', description: 'Малък магазин за ръчно изработени подаръци. Поръчка с един имейл, доставка до 2 дни.',
        nav: [['Продукти', '/products.html'], ['Как се поръчва', '/#how'], ['Отзиви', '/#reviews'], ['Контакт', '/#contact']], headerCta: ['Поръчай', '/#contact'],
        pages: {
          index: {
            hero: { eyebrow: 'Безплатна доставка над 60 лв.', eyebrowIcon: 'gift', title: 'Подаръци, които <em>се помнят</em>', lead: 'Свещи, керамика и текстил, изработени на ръка в малки серии. Всеки предмет е единствен по рода си.', cta: ['Разгледай продуктите', '/products.html'], cta2: ['Как се поръчва', '/#how'],
              card: { icon: 'bag', title: 'Най-продавани', rows: [['Свещ „Лавандула“', '24 лв.'], ['Керамична чаша', '32 лв.'], ['Ленена торба', '28 лв.']], note: 'Наличност: обновена днес.' } },
            sections: [
              { type: 'gallery', title: 'Колекции', intro: 'Сменете плочките със снимки на продуктите.', items: ['Свещи', 'Керамика', 'Текстил', 'Подаръчни комплекти'] },
              { type: 'steps', id: 'how', alt: true, title: 'Как се поръчва', items: [['Избирате', 'Разглеждате продуктите и ни пишете кои искате.'], ['Потвърждаваме', 'До няколко часа — с наличност и обща цена.'], ['Изпращаме', 'С куриер до офис или адрес, до 2 работни дни.'], ['Плащате', 'С наложен платеж или по банков път.']] },
              { type: 'cards', title: 'Защо при нас', items: [['hand', 'Ръчна изработка', 'Правим всичко в ателието си в Пловдив.'], ['leaf', 'Естествени материали', 'Соев восък, глина, лен и памук.'], ['gift', 'Подаръчна опаковка', 'Безплатно, с картичка по ваш текст.']] },
              { type: 'quotes', id: 'reviews', alt: true, title: 'Отзиви', items: [['„Свещта ухае невероятно, а опаковката беше като подарък сама по себе си.“', 'Габриела'], ['„Поръчах чаши за цялото семейство — всички са различни и прекрасни.“', 'Николай'], ['„Бърза доставка и много мил подход.“', 'Теодора']] },
              { type: 'contact', id: 'contact', title: 'Поръчка и въпроси', intro: 'Напишете кои продукти искате и адрес за доставка.', formName: 'order', rows: contactRows('bg'), messageLabel: 'Продукти и адрес за доставка', send: 'Изпрати поръчка' },
            ] },
          products: {
            title: 'Продукти и цени', description: 'Всички продукти: свещи, керамика, текстил и подаръчни комплекти с цени.',
            pagehead: ['Продукти', 'Цените са с ДДС. Доставка 6 лв., безплатна над 60 лв.'],
            sections: [
              { type: 'menu', groups: [
                { name: 'Свещи', items: [['„Лавандула“', 'Соев восък, 200 г, 40 ч. горене', '24 лв.'], ['„Горски плодове“', 'Соев восък, 200 г', '24 лв.'], ['Комплект от три', 'Мини свещи, 3 × 80 г', '36 лв.']] },
                { name: 'Керамика', items: [['Чаша за кафе', 'Ръчно глазирана, 300 мл', '32 лв.'], ['Купичка', 'Ø 14 см', '28 лв.'], ['Ваза', 'Височина 22 см', '58 лв.']] },
                { name: 'Текстил', items: [['Ленена торба', 'С дълги дръжки', '28 лв.'], ['Кухненска кърпа', 'Лен, 50 × 70 см', '18 лв.']] },
                { name: 'Подаръчни комплекти', items: [['„Уютна вечер“', 'Свещ, чаша, чай', '69 лв.'], ['„За дома“', 'Ваза, кърпа, свещ', '95 лв.']] },
              ] },
              { type: 'cta', h: 'Искате нещо по поръчка?', p: 'Правим персонализирани подаръци за сватби и фирми.', button: ['Пишете ни', '/#contact'] },
            ] },
        },
      },
      en: {
        tagline: 'handmade things with character', description: 'A small shop for handmade gifts. Order with one email, delivered within 2 days.',
        nav: [['Products', '/products.html'], ['How to order', '/#how'], ['Reviews', '/#reviews'], ['Contact', '/#contact']], headerCta: ['Order', '/#contact'],
        pages: {
          index: {
            hero: { eyebrow: 'Free delivery over €30', eyebrowIcon: 'gift', title: 'Gifts people <em>remember</em>', lead: 'Candles, ceramics and textiles made by hand in small batches. Every piece is one of a kind.', cta: ['Browse products', '/products.html'], cta2: ['How to order', '/#how'],
              card: { icon: 'bag', title: 'Best sellers', rows: [['“Lavender” candle', '€12'], ['Ceramic mug', '€16'], ['Linen tote', '€14']], note: 'Stock: updated today.' } },
            sections: [
              { type: 'gallery', title: 'Collections', intro: 'Replace the tiles with product photos.', items: ['Candles', 'Ceramics', 'Textiles', 'Gift sets'] },
              { type: 'steps', id: 'how', alt: true, title: 'How to order', items: [['Choose', 'Browse and tell us what you would like.'], ['Confirm', 'Within hours — stock and total price.'], ['Ship', 'By courier to a locker or your door in 2 working days.'], ['Pay', 'Cash on delivery or bank transfer.']] },
              { type: 'cards', title: 'Why us', items: [['hand', 'Handmade', 'Everything is made in our Plovdiv studio.'], ['leaf', 'Natural materials', 'Soy wax, clay, linen and cotton.'], ['gift', 'Gift wrapping', 'Free, with a card in your words.']] },
              { type: 'quotes', id: 'reviews', alt: true, title: 'Reviews', items: [['“The candle smells amazing and the packaging felt like a gift itself.”', 'Gabriela'], ['“Mugs for the whole family — all different and all lovely.”', 'Nikolay'], ['“Fast delivery and such a kind approach.”', 'Teodora']] },
              { type: 'contact', id: 'contact', title: 'Orders and questions', intro: 'Tell us which products you want and where to deliver.', formName: 'order', rows: contactRows('en'), messageLabel: 'Products and delivery address', send: 'Send order' },
            ] },
          products: {
            title: 'Products and prices', description: 'All products: candles, ceramics, textiles and gift sets with prices.',
            pagehead: ['Products', 'Prices include VAT. Delivery €3, free over €30.'],
            sections: [
              { type: 'menu', groups: [
                { name: 'Candles', items: [['“Lavender”', 'Soy wax, 200 g, 40 h burn', '€12'], ['“Forest berries”', 'Soy wax, 200 g', '€12'], ['Set of three', 'Mini candles, 3 × 80 g', '€18']] },
                { name: 'Ceramics', items: [['Coffee mug', 'Hand-glazed, 300 ml', '€16'], ['Bowl', 'Ø 14 cm', '€14'], ['Vase', '22 cm tall', '€29']] },
                { name: 'Textiles', items: [['Linen tote', 'Long handles', '€14'], ['Tea towel', 'Linen, 50 × 70 cm', '€9']] },
                { name: 'Gift sets', items: [['“Cosy evening”', 'Candle, mug, tea', '€35'], ['“For the home”', 'Vase, towel, candle', '€48']] },
              ] },
              { type: 'cta', h: 'Want something custom?', p: 'We make personalised gifts for weddings and companies.', button: ['Write to us', '/#contact'] },
            ] },
        },
      },
    },
  },
  {
    id: 'realestate', category: 'commerce', sf: 'building.2', mark: 'home',
    theme: light('#f6f7f9', '#eceff4', '#ffffff', '#0f172a', '#526074', '#1e40af', '#3b82f6', { head: 'serif', radius: 14 }),
    lang: {
      bg: {
        tagline: 'агенция за недвижими имоти', description: 'Продажба и наем на жилища и офиси. Безплатна оценка на имота ви до 48 часа.',
        nav: [['Имоти', '/listings.html'], ['Услуги', '/#services'], ['Отзиви', '/#reviews'], ['Контакт', '/#contact']], headerCta: ['Безплатна оценка', '/#contact'],
        pages: {
          index: {
            hero: { eyebrow: 'Над 300 сделки миналата година', eyebrowIcon: 'home', title: 'Вашият следващ дом <em>е тук</em>', lead: 'Купуваме, продаваме и отдаваме под наем с прозрачни условия, проверени документи и брокер, който е на ваша страна.', cta: ['Виж имотите', '/listings.html'], cta2: ['Оцени моя имот', '/#contact'],
              card: { icon: 'home', title: 'Нови оферти', rows: [['2-стаен, Лозенец', '189 000 €'], ['3-стаен, Бояна', '320 000 €'], ['Офис, Център', '1 400 €/мес.']], note: 'Цените са ориентировъчни.' } },
            sections: [
              { type: 'cards', id: 'services', title: 'С какво помагаме', items: [['home', 'Продажба', 'Оценка, професионални снимки, огледи и договаряне.'], ['key', 'Покупка', 'Подбор по вашите критерии и проверка на документите.'], ['calendar', 'Наем', 'Наематели с проверена история и договор, който ви пази.'], ['shield', 'Правна помощ', 'Нотариус, ипотека и прехвърляне — от един човек.']] },
              { type: 'stats', alt: true, items: [['300+', 'сделки за година'], ['21 дни', 'средно до продажба'], ['0 лв.', 'комисиона за купувача'], ['4.9/5', 'оценка на клиентите']] },
              { type: 'quotes', id: 'reviews', title: 'Клиентите за нас', items: [['„Продадохме апартамента за три седмици, на по-добра цена от очакваното.“', 'Семейство Тодорови'], ['„Всички документи бяха проверени, преди да кажем „да“. Спокойствие.“', 'Александър'], ['„Намериха ни офис точно по изискванията.“', 'Studio North']] },
              { type: 'contact', id: 'contact', alt: true, title: 'Безплатна оценка', intro: 'Кажете ни за имота — ще получите пазарна оценка до 48 часа.', formName: 'valuation', rows: contactRows('bg', [addr('bg')]), fields: [{ id: 'type', label: 'Вид имот', options: ['Апартамент', 'Къща', 'Офис', 'Парцел'] }, { id: 'area', label: 'Квартал / град' }], messageLabel: 'Площ, етаж и състояние', send: 'Поискай оценка' },
            ] },
          listings: {
            title: 'Имоти за продажба и наем', description: 'Актуални оферти за апартаменти, къщи и офиси за продажба и под наем.',
            pagehead: ['Имоти', 'Актуални оферти. Попитайте за имоти, които още не са публикувани.'],
            sections: [
              { type: 'menu', groups: [
                { name: 'Продажба', items: [['2-стаен, Лозенец', '68 м², ет. 4, южно изложение', '189 000 €'], ['3-стаен, Бояна', '112 м², градина, паркомясто', '320 000 €'], ['Къща, Панчарево', '180 м², двор 600 м²', '420 000 €']] },
                { name: 'Наем', items: [['1-стаен, Център', 'Обзаведен, до метро', '650 €/мес.'], ['Офис, Център', '120 м², 8 работни места', '1 400 €/мес.']] },
              ] },
              { type: 'gallery', alt: true, title: 'Снимки', intro: 'Заменете с реални снимки на имотите.', items: ['Лозенец — дневна', 'Бояна — градина', 'Панчарево — фасада', 'Център — офис'] },
            ] },
        },
      },
      en: {
        tagline: 'real estate agency', description: 'Homes and offices for sale and rent. A free valuation of your property within 48 hours.',
        nav: [['Listings', '/listings.html'], ['Services', '/#services'], ['Reviews', '/#reviews'], ['Contact', '/#contact']], headerCta: ['Free valuation', '/#contact'],
        pages: {
          index: {
            hero: { eyebrow: 'Over 300 deals last year', eyebrowIcon: 'home', title: 'Your next home <em>is here</em>', lead: 'We buy, sell and let with clear terms, verified paperwork and an agent who is on your side.', cta: ['See listings', '/listings.html'], cta2: ['Value my property', '/#contact'],
              card: { icon: 'home', title: 'New listings', rows: [['2-bed, Lozenets', '€189,000'], ['3-bed, Boyana', '€320,000'], ['Office, Centre', '€1,400/mo']], note: 'Prices are indicative.' } },
            sections: [
              { type: 'cards', id: 'services', title: 'How we help', items: [['home', 'Selling', 'Valuation, professional photos, viewings and negotiation.'], ['key', 'Buying', 'Shortlists that match your needs and checked paperwork.'], ['calendar', 'Letting', 'Vetted tenants and a contract that protects you.'], ['shield', 'Legal help', 'Notary, mortgage and transfer — one person handles it.']] },
              { type: 'stats', alt: true, items: [['300+', 'deals a year'], ['21 days', 'average time to sell'], ['€0', 'buyer commission'], ['4.9/5', 'client rating']] },
              { type: 'quotes', id: 'reviews', title: 'Clients about us', items: [['“We sold our flat in three weeks, above what we expected.”', 'The Todorov family'], ['“Every document was checked before we said yes. Peace of mind.”', 'Alexander'], ['“They found us an office that ticked every box.”', 'Studio North']] },
              { type: 'contact', id: 'contact', alt: true, title: 'Free valuation', intro: 'Tell us about the property — a market valuation within 48 hours.', formName: 'valuation', rows: contactRows('en', [addr('en')]), fields: [{ id: 'type', label: 'Property type', options: ['Apartment', 'House', 'Office', 'Land'] }, { id: 'area', label: 'Area / city' }], messageLabel: 'Size, floor and condition', send: 'Request a valuation' },
            ] },
          listings: {
            title: 'Properties for sale and rent', description: 'Current apartments, houses and offices for sale and to let.',
            pagehead: ['Listings', 'Current offers. Ask about properties that are not published yet.'],
            sections: [
              { type: 'menu', groups: [
                { name: 'For sale', items: [['2-bed, Lozenets', '68 m², 4th floor, south facing', '€189,000'], ['3-bed, Boyana', '112 m², garden, parking', '€320,000'], ['House, Pancharevo', '180 m², 600 m² plot', '€420,000']] },
                { name: 'To let', items: [['Studio, Centre', 'Furnished, next to the metro', '€650/mo'], ['Office, Centre', '120 m², 8 desks', '€1,400/mo']] },
              ] },
              { type: 'gallery', alt: true, title: 'Photos', intro: 'Replace with real photos of the properties.', items: ['Lozenets — living room', 'Boyana — garden', 'Pancharevo — front', 'Centre — office'] },
            ] },
        },
      },
    },
  },
  // ------------------------------------------------------------------ tech
  {
    id: 'saas', category: 'tech', sf: 'cloud', mark: 'chart',
    theme: dark('#0a0c16', '#0f1220', '#141830', '#6366f1', '#22d3ee', { radius: 16 }),
    lang: {
      bg: {
        tagline: 'софтуер, който пести часове', description: 'Автоматизирайте рутинната работа на екипа. 14 дни безплатно, без кредитна карта.',
        nav: [['Възможности', '/#features'], ['Цени', '/pricing.html'], ['Въпроси', '/#faq']], headerCta: ['Опитай безплатно', '/#start'],
        pages: {
          index: {
            hero: { eyebrow: 'Ново: интеграция със Slack', eyebrowIcon: 'spark', title: 'По-малко рутина, <em>повече работа</em>', lead: 'Една платформа за задачи, отчети и автоматизации. Екипите пестят средно 6 часа седмично още от първия месец.', cta: ['Опитай 14 дни безплатно', '/#start'], cta2: ['Виж цените', '/pricing.html'],
              card: { icon: 'chart', title: 'Тази седмица', rows: [['Автоматизирани задачи', '1 284'], ['Спестено време', '38 ч.'], ['Доволни клиенти', '+12%']], note: 'Табло в реално време.' } },
            sections: [
              { type: 'stats', items: [['2 400+', 'екипа'], ['6 ч.', 'спестени седмично'], ['99,95%', 'наличност'], ['4.8/5', 'оценка']] },
              { type: 'cards', id: 'features', alt: true, title: 'Всичко на едно място', intro: 'Започнете с шаблон и настройте за минути — без програмиране.', items: [['bolt', 'Автоматизации', 'Правила „ако — тогава“ за повтарящите се задачи.'], ['chart', 'Отчети', 'Табла в реално време, които се изпращат сами.'], ['link', 'Интеграции', 'Slack, Google, Stripe и още 50 услуги.'], ['shield', 'Сигурност', 'Криптиране, SSO и данни, съхранявани в ЕС.']] },
              { type: 'steps', title: 'Започнете за 3 минути', items: [['Регистрация', 'Само имейл — без карта.'], ['Шаблон', 'Изберете готов процес за вашия екип.'], ['Покана', 'Добавете колегите с един линк.']] },
              { type: 'quotes', alt: true, title: 'Екипите казват', items: [['„Спряхме да губим задачи между имейлите. Всичко е на едно място.“', 'Радослав, CTO'], ['„Отчетът в понеделник вече се пише сам.“', 'Лора, мениджър операции'], ['„Настроихме го за следобед.“', 'Калин, основател']] },
              { type: 'faq', id: 'faq', title: 'Въпроси', items: [['Трябва ли карта за пробния период?', 'Не. След 14 дни избирате план или акаунтът минава на безплатния.'], ['Къде се пазят данните?', 'В дата центрове в ЕС, криптирани при съхранение и пренос.'], ['Мога ли да откажа по всяко време?', 'Да, с един клик от настройките. Без договори.']] },
              { type: 'form', id: 'start', alt: true, title: 'Започнете безплатно', intro: 'Ще ви изпратим линк за вход и кратко ръководство.', formName: 'trial', button: 'Създай акаунт', note: '14 дни безплатно. Без кредитна карта.' },
            ] },
          pricing: {
            title: 'Цени и планове', description: 'Прозрачни планове за екипи от всякакъв размер. 14 дни безплатно.',
            pagehead: ['Цени', 'Плащате месечно или годишно (два месеца подарък). Откажете по всяко време.'],
            sections: [
              { type: 'pricing', items: [
                { name: 'Старт', price: '0 €', per: '/ месец', features: ['До 3 потребители', '100 автоматизации / мес.', 'Основни отчети'], cta: ['Започни', '/#start'] },
                { name: 'Екип', price: '12 €', per: '/ потребител', featured: 'Най-популярен', features: ['Неограничени автоматизации', 'Всички интеграции', 'Приоритетна поддръжка'], cta: ['Опитай безплатно', '/#start'] },
                { name: 'Бизнес', price: '29 €', per: '/ потребител', features: ['SSO и одитен дневник', 'Отделен мениджър', 'SLA 99,95%'], cta: ['Свържи се с нас', MAIL] },
              ] },
              { type: 'faq', alt: true, title: 'Въпроси за плащането', items: [['Има ли ДДС?', 'Цените са без ДДС. Фирмите в ЕС с ДДС номер не плащат ДДС.'], ['Как се плаща?', 'С карта или по фактура за годишните планове.']] },
            ] },
        },
      },
      en: {
        tagline: 'software that saves hours', description: 'Automate your team’s routine work. 14 days free, no credit card.',
        nav: [['Features', '/#features'], ['Pricing', '/pricing.html'], ['FAQ', '/#faq']], headerCta: ['Try it free', '/#start'],
        pages: {
          index: {
            hero: { eyebrow: 'New: Slack integration', eyebrowIcon: 'spark', title: 'Less busywork, <em>more real work</em>', lead: 'One platform for tasks, reports and automations. Teams save 6 hours a week on average from the first month.', cta: ['Start a 14-day trial', '/#start'], cta2: ['See pricing', '/pricing.html'],
              card: { icon: 'chart', title: 'This week', rows: [['Automated tasks', '1,284'], ['Time saved', '38 h'], ['Happy customers', '+12%']], note: 'A real-time dashboard.' } },
            sections: [
              { type: 'stats', items: [['2,400+', 'teams'], ['6 h', 'saved every week'], ['99.95%', 'uptime'], ['4.8/5', 'rating']] },
              { type: 'cards', id: 'features', alt: true, title: 'Everything in one place', intro: 'Start from a template and set it up in minutes — no code.', items: [['bolt', 'Automations', '“If this, then that” rules for repeating work.'], ['chart', 'Reports', 'Real-time dashboards that send themselves.'], ['link', 'Integrations', 'Slack, Google, Stripe and 50 more.'], ['shield', 'Security', 'Encryption, SSO and data stored in the EU.']] },
              { type: 'steps', title: 'Up and running in 3 minutes', items: [['Sign up', 'Just an email — no card.'], ['Pick a template', 'A ready-made workflow for your team.'], ['Invite', 'Add colleagues with one link.']] },
              { type: 'quotes', alt: true, title: 'Teams say', items: [['“We stopped losing tasks in email. Everything is in one place.”', 'Radoslav, CTO'], ['“The Monday report now writes itself.”', 'Laura, operations manager'], ['“We set it up in an afternoon.”', 'Kalin, founder']] },
              { type: 'faq', id: 'faq', title: 'FAQ', items: [['Do I need a card for the trial?', 'No. After 14 days you pick a plan or move to the free one.'], ['Where is my data stored?', 'In EU data centres, encrypted at rest and in transit.'], ['Can I cancel any time?', 'Yes, with one click in settings. No contracts.']] },
              { type: 'form', id: 'start', alt: true, title: 'Start for free', intro: 'We send you a sign-in link and a short guide.', formName: 'trial', button: 'Create account', note: '14 days free. No credit card.' },
            ] },
          pricing: {
            title: 'Pricing and plans', description: 'Clear plans for teams of every size. 14 days free.',
            pagehead: ['Pricing', 'Pay monthly or yearly (two months free). Cancel any time.'],
            sections: [
              { type: 'pricing', items: [
                { name: 'Starter', price: '€0', per: '/ month', features: ['Up to 3 users', '100 automations / month', 'Basic reports'], cta: ['Get started', '/#start'] },
                { name: 'Team', price: '€12', per: '/ user', featured: 'Most popular', features: ['Unlimited automations', 'All integrations', 'Priority support'], cta: ['Try it free', '/#start'] },
                { name: 'Business', price: '€29', per: '/ user', features: ['SSO and audit log', 'Dedicated manager', '99.95% SLA'], cta: ['Contact us', MAIL] },
              ] },
              { type: 'faq', alt: true, title: 'Billing questions', items: [['Is VAT included?', 'Prices exclude VAT. EU businesses with a VAT number pay no VAT.'], ['How do I pay?', 'By card, or by invoice on yearly plans.']] },
            ] },
        },
      },
    },
  },
  {
    id: 'app', category: 'tech', sf: 'iphone', mark: 'play',
    theme: light('#f7f8ff', '#eef0fd', '#ffffff', '#141633', '#555a7a', '#2563eb', '#7c3aed', { font: 'rounded', radius: 22, tilt: -3 }),
    lang: {
      bg: {
        tagline: 'мобилно приложение', description: 'Приложението, което подрежда деня ви. Безплатно за iPhone и Android.',
        nav: [['Функции', '/#features'], ['Как работи', '/#how'], ['Отзиви', '/#reviews'], ['Въпроси', '/#faq']], headerCta: ['Изтегли', '/#download'],
        pages: { index: {
          hero: { eyebrow: '№1 в „Продуктивност“ тази седмица', eyebrowIcon: 'star', title: 'Денят ви, <em>подреден</em>', lead: 'Задачи, навици и напомняния в едно красиво приложение. Синхронизира се между телефона, таблета и компютъра.', cta: ['Изтегли безплатно', '/#download'], cta2: ['Как работи', '/#how'],
            card: { icon: 'check', title: 'Днес', rows: [['Разходка 30 мин.', '✓'], ['Среща с екипа', '10:00'], ['Вода: 6 от 8 чаши', '75%']], note: 'Добро утро! Имате 3 задачи за днес.' } },
          sections: [
            { type: 'cards', id: 'features', title: 'Какво може', items: [['check', 'Задачи', 'Бързо добавяне с глас и умни списъци.'], ['heart', 'Навици', 'Серии, които ви мотивират всеки ден.'], ['clock', 'Напомняния', 'В точния момент и на точното място.'], ['shield', 'Поверителност', 'Данните ви са криптирани и остават ваши.']] },
            { type: 'steps', id: 'how', alt: true, title: 'Как работи', items: [['Изтеглете', 'Безплатно от App Store или Google Play.'], ['Изберете цел', 'Приложението предлага начален план.'], ['Следете напредъка', 'Седмичен отчет всяка неделя.']] },
            { type: 'quotes', id: 'reviews', title: 'Потребителите казват', items: [['„Първото приложение за навици, което не изтрих след седмица.“', '★ App Store'], ['„Красиво и бързо. Гласовото добавяне е магия.“', '★ Google Play'], ['„Цялото семейство го ползва за общите задачи.“', '★ App Store']] },
            { type: 'faq', id: 'faq', alt: true, title: 'Въпроси', items: [['Безплатно ли е?', 'Да. Pro версията добавя теми, споделени списъци и статистика.'], ['Работи ли офлайн?', 'Да — синхронизира се, когато има връзка.']] },
            { type: 'cta', id: 'download', h: 'Изтеглете днес', p: 'Безплатно за iPhone и Android. Pro — 30 дни безплатно.', button: ['Изтегли за iPhone и Android', MAIL] },
          ] } },
      },
      en: {
        tagline: 'mobile app', description: 'The app that organises your day. Free for iPhone and Android.',
        nav: [['Features', '/#features'], ['How it works', '/#how'], ['Reviews', '/#reviews'], ['FAQ', '/#faq']], headerCta: ['Download', '/#download'],
        pages: { index: {
          hero: { eyebrow: '#1 in Productivity this week', eyebrowIcon: 'star', title: 'Your day, <em>sorted</em>', lead: 'Tasks, habits and reminders in one beautiful app. Syncs between your phone, tablet and computer.', cta: ['Download free', '/#download'], cta2: ['How it works', '/#how'],
            card: { icon: 'check', title: 'Today', rows: [['30 min walk', '✓'], ['Team meeting', '10:00'], ['Water: 6 of 8 glasses', '75%']], note: 'Good morning! You have 3 tasks today.' } },
          sections: [
            { type: 'cards', id: 'features', title: 'What it does', items: [['check', 'Tasks', 'Quick voice capture and smart lists.'], ['heart', 'Habits', 'Streaks that keep you going every day.'], ['clock', 'Reminders', 'At the right time and the right place.'], ['shield', 'Privacy', 'Your data is encrypted and stays yours.']] },
            { type: 'steps', id: 'how', alt: true, title: 'How it works', items: [['Download', 'Free on the App Store or Google Play.'], ['Pick a goal', 'The app suggests a starting plan.'], ['Track progress', 'A weekly report every Sunday.']] },
            { type: 'quotes', id: 'reviews', title: 'Users say', items: [['“The first habit app I did not delete after a week.”', '★ App Store'], ['“Beautiful and fast. Voice capture is magic.”', '★ Google Play'], ['“The whole family uses it for shared chores.”', '★ App Store']] },
            { type: 'faq', id: 'faq', alt: true, title: 'FAQ', items: [['Is it free?', 'Yes. Pro adds themes, shared lists and statistics.'], ['Does it work offline?', 'Yes — it syncs when you are back online.']] },
            { type: 'cta', id: 'download', h: 'Download today', p: 'Free for iPhone and Android. Pro is free for 30 days.', button: ['Get it for iPhone and Android', MAIL] },
          ] } },
      },
    },
  },
  // ------------------------------------------------------------------ personal
  {
    id: 'portfolio', category: 'personal', sf: 'rectangle.3.group', mark: 'camera',
    theme: light('#fafaf8', '#f1f0ec', '#ffffff', '#141414', '#5c5c5c', '#ff5a36', '#ff9f1c', { radius: 12, tilt: 0 }),
    lang: {
      bg: {
        tagline: 'дизайн и визуални истории', description: 'Портфолио с избрани проекти, процес на работа и контакт за нови поръчки.',
        nav: [['Работи', '/work.html'], ['За мен', '/about.html'], ['Контакт', '/#contact']], headerCta: ['Нов проект', '/#contact'],
        pages: {
          index: {
            hero: { eyebrow: 'Свободен за проекти от ноември', eyebrowIcon: 'spark', title: 'Създавам визия, <em>която продава</em>', lead: 'Бранд идентичност, уеб дизайн и фотография за малки бизнеси и смели идеи.', cta: ['Виж работите', '/work.html'], cta2: ['Нов проект', '/#contact'] },
            sections: [
              { type: 'gallery', title: 'Избрани проекти', intro: 'Сменете плочките с корици на проектите си.', items: ['Кафе „Зрънце“ — бранд', 'Studio North — уебсайт', 'Винарна „Хълм“ — етикети', 'Ателие „Лен“ — фотография', 'Фестивал „Звук“ — плакати', 'Приложение „Ден“ — UI'] },
              { type: 'cards', alt: true, title: 'Услуги', items: [['spark', 'Бранд идентичност', 'Лого, цветове, шрифтове и правила за употреба.'], ['globe', 'Уеб дизайн', 'Сайтове, които изглеждат добре и носят запитвания.'], ['camera', 'Фотография', 'Продукти, хора и пространства.']] },
              { type: 'quotes', title: 'Клиентите казват', items: [['„Разбра бизнеса ни по-добре от нас самите.“', 'Мила, кафе „Зрънце“'], ['„Сайтът удвои запитванията за два месеца.“', 'Studio North']] },
              { type: 'contact', id: 'contact', alt: true, title: 'Да работим заедно', intro: 'Разкажете за проекта — отговарям до два дни.', formName: 'project', rows: contactRows('bg'), fields: [{ id: 'budget', label: 'Бюджет', options: ['до 1 000 €', '1 000 – 3 000 €', '3 000 – 8 000 €', 'над 8 000 €'] }], messageLabel: 'За проекта', send: 'Изпрати' },
            ] },
          work: {
            title: 'Работи и проекти', description: 'Избрани проекти: бранд идентичност, уеб дизайн и фотография.',
            pagehead: ['Работи', 'Всеки проект започва с въпрос — ето как отговорихме.'],
            sections: [
              { type: 'posts', items: [
                { tag: 'Бранд', date: '2026', h: 'Кафе „Зрънце“', p: 'Нова идентичност за квартално кафе — от логото до чашите.', href: '/#contact' },
                { tag: 'Уеб', date: '2026', h: 'Studio North', p: 'Сайт за архитектурно студио, който удвои запитванията.', href: '/#contact' },
                { tag: 'Опаковка', date: '2025', h: 'Винарна „Хълм“', p: 'Серия етикети, вдъхновени от терените на лозята.', href: '/#contact' },
                { tag: 'Фото', date: '2025', h: 'Ателие „Лен“', p: 'Продуктова фотография за онлайн каталог.', href: '/#contact' },
              ] },
            ] },
          about: {
            title: 'За мен и процеса', description: 'Кой стои зад портфолиото, как работя и с какви инструменти.',
            pagehead: ['За мен', 'Дизайнер с 10 години опит в агенции и с малки бизнеси.'],
            sections: [
              { type: 'prose', items: [['', 'Разкажете с няколко изречения кой сте, какво обичате да правите и защо клиентите работят с вас. Истинското име и снимка изграждат доверие.'], ['Как работя', 'Започвам с разговор и кратко проучване, после предлагам две посоки, избираме една и я довеждаме до край. Без изненади в цената.']] },
              { type: 'timeline', alt: true, title: 'Опит', items: [['2021 — днес', 'Свободна практика', 'Бранд и уеб за над 60 клиента.'], ['2017 — 2021', 'Арт директор, агенция', 'Кампании за национални марки.'], ['2015 — 2017', 'Дизайнер', 'Печат, опаковки и илюстрация.']] },
              { type: 'chips', title: 'Инструменти', items: ['Figma', 'Illustrator', 'Photoshop', 'Lightroom', 'Webflow', 'HTML и CSS'] },
            ] },
        },
      },
      en: {
        tagline: 'design and visual stories', description: 'A portfolio of selected projects, the process and a way to start a new one.',
        nav: [['Work', '/work.html'], ['About', '/about.html'], ['Contact', '/#contact']], headerCta: ['New project', '/#contact'],
        pages: {
          index: {
            hero: { eyebrow: 'Available for projects from November', eyebrowIcon: 'spark', title: 'I create visuals <em>that sell</em>', lead: 'Brand identity, web design and photography for small businesses and bold ideas.', cta: ['See the work', '/work.html'], cta2: ['New project', '/#contact'] },
            sections: [
              { type: 'gallery', title: 'Selected projects', intro: 'Replace the tiles with your project covers.', items: ['Zrantse Coffee — brand', 'Studio North — website', 'Halm Winery — labels', 'Len Atelier — photography', 'Zvuk Festival — posters', 'Den App — UI'] },
              { type: 'cards', alt: true, title: 'Services', items: [['spark', 'Brand identity', 'Logo, colours, typefaces and usage rules.'], ['globe', 'Web design', 'Sites that look good and bring enquiries.'], ['camera', 'Photography', 'Products, people and spaces.']] },
              { type: 'quotes', title: 'Clients say', items: [['“Understood our business better than we did.”', 'Mila, Zrantse Coffee'], ['“The site doubled our enquiries in two months.”', 'Studio North']] },
              { type: 'contact', id: 'contact', alt: true, title: 'Let’s work together', intro: 'Tell me about the project — I reply within two days.', formName: 'project', rows: contactRows('en'), fields: [{ id: 'budget', label: 'Budget', options: ['up to €1,000', '€1,000 – €3,000', '€3,000 – €8,000', 'over €8,000'] }], messageLabel: 'About the project', send: 'Send' },
            ] },
          work: {
            title: 'Work and projects', description: 'Selected projects: brand identity, web design and photography.',
            pagehead: ['Work', 'Every project starts with a question — here is how we answered.'],
            sections: [
              { type: 'posts', items: [
                { tag: 'Brand', date: '2026', h: 'Zrantse Coffee', p: 'A new identity for a neighbourhood café — from logo to cups.', href: '/#contact' },
                { tag: 'Web', date: '2026', h: 'Studio North', p: 'A site for an architecture studio that doubled enquiries.', href: '/#contact' },
                { tag: 'Packaging', date: '2025', h: 'Halm Winery', p: 'A label series inspired by the vineyard terrain.', href: '/#contact' },
                { tag: 'Photo', date: '2025', h: 'Len Atelier', p: 'Product photography for an online catalogue.', href: '/#contact' },
              ] },
            ] },
          about: {
            title: 'About me and the process', description: 'Who is behind the portfolio, how I work and with which tools.',
            pagehead: ['About', 'A designer with 10 years in agencies and with small businesses.'],
            sections: [
              { type: 'prose', items: [['', 'Say in a few sentences who you are, what you love doing and why clients work with you. A real name and photo build trust.'], ['How I work', 'I start with a conversation and a short research phase, propose two directions, we pick one and take it all the way. No surprises in the price.']] },
              { type: 'timeline', alt: true, title: 'Experience', items: [['2021 — now', 'Freelance', 'Brand and web for over 60 clients.'], ['2017 — 2021', 'Art director, agency', 'Campaigns for national brands.'], ['2015 — 2017', 'Designer', 'Print, packaging and illustration.']] },
              { type: 'chips', title: 'Tools', items: ['Figma', 'Illustrator', 'Photoshop', 'Lightroom', 'Webflow', 'HTML and CSS'] },
            ] },
        },
      },
    },
  },
  {
    id: 'resume', category: 'personal', sf: 'person.text.rectangle', mark: 'users',
    theme: light('#fafafa', '#f1f3f4', '#ffffff', '#18181b', '#52525b', '#0f766e', '#0891b2', { radius: 14, tilt: 0 }),
    lang: {
      bg: {
        tagline: 'автобиография и опит', description: 'Професионален опит, умения и проекти — и как да се свържете за работа.',
        nav: [['Опит', '/#experience'], ['Умения', '/#skills'], ['Проекти', '/#projects'], ['Контакт', '/#contact']], headerCta: ['Свържи се', MAIL],
        pages: { index: {
          hero: { eyebrow: 'Отворен за нови възможности', eyebrowIcon: 'spark', title: 'Здравейте, аз съм <em>{{NAME}}</em>', lead: 'Продуктов мениджър с 8 години опит в софтуерни компании. Превръщам сложни проблеми в прости продукти, които хората обичат.', cta: ['Свържи се', MAIL], cta2: ['Виж опита', '/#experience'], chips: ['София / дистанционно', 'Български, английски, немски'] },
          sections: [
            { type: 'timeline', id: 'experience', title: 'Опит', items: [['2022 — днес', 'Старши продуктов мениджър · Компания А', 'Водя екип от 12 души. Ръст на активните потребители с 40% за година.'], ['2019 — 2022', 'Продуктов мениджър · Компания Б', 'Пуснах мобилното приложение от нулата до 200 000 потребители.'], ['2016 — 2019', 'Бизнес анализатор · Компания В', 'Анализи и процеси за отдела по продажби.'], ['2012 — 2016', 'Бакалавър, Икономика · СУ', 'Дипломна работа за поведенческа икономика.']] },
            { type: 'chips', id: 'skills', alt: true, title: 'Умения', items: ['Продуктова стратегия', 'Потребителски проучвания', 'Agile / Scrum', 'SQL и анализ', 'Figma', 'Водене на екипи', 'Публично говорене'] },
            { type: 'cards', id: 'projects', title: 'Избрани проекти', items: [['rocket', 'Мобилно приложение', 'От идея до 200 000 потребители за 18 месеца.'], ['chart', 'Нова ценова политика', '+18% приходи без загуба на клиенти.'], ['users', 'Програма за менторство', '30 младши колеги, 8 от тях вече водят екипи.']] },
            { type: 'contact', id: 'contact', alt: true, title: 'Контакт', intro: 'Пишете ми за роли, проекти или просто за кафе.', rows: contactRows('bg', [['link', 'LinkedIn', 'linkedin.com/in/…', 'https://www.linkedin.com/']]), send: 'Изпрати' },
          ] } },
      },
      en: {
        tagline: 'résumé and experience', description: 'Professional experience, skills and projects — and how to get in touch about work.',
        nav: [['Experience', '/#experience'], ['Skills', '/#skills'], ['Projects', '/#projects'], ['Contact', '/#contact']], headerCta: ['Get in touch', MAIL],
        pages: { index: {
          hero: { eyebrow: 'Open to new opportunities', eyebrowIcon: 'spark', title: 'Hi, I’m <em>{{NAME}}</em>', lead: 'A product manager with 8 years at software companies. I turn complex problems into simple products people love.', cta: ['Get in touch', MAIL], cta2: ['See experience', '/#experience'], chips: ['Sofia / remote', 'Bulgarian, English, German'] },
          sections: [
            { type: 'timeline', id: 'experience', title: 'Experience', items: [['2022 — now', 'Senior Product Manager · Company A', 'Leading a team of 12. Active users up 40% in a year.'], ['2019 — 2022', 'Product Manager · Company B', 'Launched the mobile app from zero to 200,000 users.'], ['2016 — 2019', 'Business Analyst · Company C', 'Analysis and processes for the sales department.'], ['2012 — 2016', 'BSc Economics · Sofia University', 'Thesis on behavioural economics.']] },
            { type: 'chips', id: 'skills', alt: true, title: 'Skills', items: ['Product strategy', 'User research', 'Agile / Scrum', 'SQL and analytics', 'Figma', 'Team leadership', 'Public speaking'] },
            { type: 'cards', id: 'projects', title: 'Selected projects', items: [['rocket', 'Mobile app', 'From idea to 200,000 users in 18 months.'], ['chart', 'New pricing', '+18% revenue with no customer loss.'], ['users', 'Mentoring program', '30 junior colleagues, 8 of them now lead teams.']] },
            { type: 'contact', id: 'contact', alt: true, title: 'Contact', intro: 'Write to me about roles, projects or just a coffee.', rows: contactRows('en', [['link', 'LinkedIn', 'linkedin.com/in/…', 'https://www.linkedin.com/']]), send: 'Send' },
          ] } },
      },
    },
  },
  {
    id: 'blog', category: 'personal', sf: 'text.book.closed', mark: 'book',
    theme: light('#fffdf8', '#f7f1e6', '#ffffff', '#221a12', '#65584a', '#c2410c', '#ea580c', { font: 'serif', head: 'serif', radius: 12, tilt: 0 }),
    lang: {
      bg: {
        tagline: 'истории, идеи и бележки', description: 'Блог за пътувания, книги и малките неща, които правят деня хубав.',
        nav: [['Статии', '/#posts'], ['За мен', '/#about'], ['Бюлетин', '/#newsletter']], headerCta: null,
        pages: {
          index: {
            hero: { center: true, eyebrow: 'Нова статия всеки четвъртък', eyebrowIcon: 'book', title: 'Истории, които <em>си струва да прочетете</em>', lead: 'Пиша за пътувания, книги и малките неща, които правят деня хубав. Без реклами, без бързане.', cta: ['Чети последната', '/post.html'], cta2: ['Абонирай се', '/#newsletter'] },
            sections: [
              { type: 'posts', id: 'posts', title: 'Последни статии', items: [
                { tag: 'Пътуване', date: '26 септември', h: 'Три дни в Родопите без телефон', p: 'Какво се случва, когато изключиш всичко и тръгнеш по пътеката.', href: '/post.html' },
                { tag: 'Книги', date: '19 септември', h: 'Пет книги за есента', p: 'Кратък списък за дългите вечери — от романи до есета.', href: '/post.html' },
                { tag: 'Живот', date: '12 септември', h: 'Малките ритуали на сутринта', p: 'Защо първите 20 минути от деня решават останалите.', href: '/post.html' },
              ] },
              { type: 'prose', id: 'about', alt: true, title: 'За мен', items: [['', 'Няколко изречения за това кой пише и защо. Читателите се връщат при човек, не при сайт.']] },
              { type: 'form', id: 'newsletter', title: 'Бюлетин', intro: 'Едно писмо в неделя с новите статии и една препоръка.', formName: 'newsletter', button: 'Абонирай ме', note: 'Без спам. Отписване с един клик.' },
            ] },
          post: {
            title: 'Три дни в Родопите без телефон', description: 'Какво се случва, когато изключиш всичко и тръгнеш по пътеката — пътепис от Родопите.',
            sections: [
              { type: 'article', tag: 'Пътуване · 26 септември', h: 'Три дни в Родопите без телефон', back: 'Всички статии', body: [
                'Това е примерна статия — заменете я със свой текст. Първият абзац е обещание: защо читателят да продължи.',
                '## Първи ден',
                'Разкажете какво се случи, какво видяхте, кого срещнахте. Кратки абзаци се четат по-лесно на телефон.',
                '> Най-хубавите пътеки са тези, които не са на картата.',
                '## Какво научих',
                'Завършете с една мисъл, която читателят ще запомни — и покана да прочете следващата статия.',
              ] },
            ] },
        },
      },
      en: {
        tagline: 'stories, ideas and notes', description: 'A blog about travel, books and the small things that make a day good.',
        nav: [['Articles', '/#posts'], ['About', '/#about'], ['Newsletter', '/#newsletter']], headerCta: null,
        pages: {
          index: {
            hero: { center: true, eyebrow: 'A new article every Thursday', eyebrowIcon: 'book', title: 'Stories <em>worth reading</em>', lead: 'I write about travel, books and the small things that make a day good. No ads, no hurry.', cta: ['Read the latest', '/post.html'], cta2: ['Subscribe', '/#newsletter'] },
            sections: [
              { type: 'posts', id: 'posts', title: 'Latest articles', items: [
                { tag: 'Travel', date: '26 September', h: 'Three days in the Rhodopes without a phone', p: 'What happens when you switch everything off and take the trail.', href: '/post.html' },
                { tag: 'Books', date: '19 September', h: 'Five books for autumn', p: 'A short list for long evenings — from novels to essays.', href: '/post.html' },
                { tag: 'Life', date: '12 September', h: 'Small morning rituals', p: 'Why the first 20 minutes decide the rest of the day.', href: '/post.html' },
              ] },
              { type: 'prose', id: 'about', alt: true, title: 'About', items: [['', 'A few sentences about who writes here and why. Readers come back to a person, not a website.']] },
              { type: 'form', id: 'newsletter', title: 'Newsletter', intro: 'One email on Sunday with the new articles and one recommendation.', formName: 'newsletter', button: 'Subscribe', note: 'No spam. Unsubscribe with one click.' },
            ] },
          post: {
            title: 'Three days in the Rhodopes without a phone', description: 'What happens when you switch everything off and take the trail — a travel story.',
            sections: [
              { type: 'article', tag: 'Travel · 26 September', h: 'Three days in the Rhodopes without a phone', back: 'All articles', body: [
                'This is a sample article — replace it with your own. The first paragraph is a promise: why the reader should keep going.',
                '## Day one',
                'Tell what happened, what you saw, who you met. Short paragraphs read better on a phone.',
                '> The best trails are the ones that are not on the map.',
                '## What I learned',
                'End with one thought the reader will remember — and an invitation to the next article.',
              ] },
            ] },
        },
      },
    },
  },
  {
    id: 'linkinbio', category: 'personal', sf: 'link', mark: 'link',
    theme: dark('#120f1f', '#1a1630', '#1e1a36', '#f43f5e', '#f59e0b', { font: 'rounded', radius: 18 }),
    lang: {
      bg: {
        tagline: 'всички линкове на едно място', description: 'Всички профили, продукти и връзки на едно място.',
        nav: [['Линкове', '/#main'], ['Контакт', MAIL]], headerCta: null,
        pages: { index: {
          hero: { center: true, avatar: '★', title: '{{NAME}}', lead: 'Създател на съдържание · пътувания, храна и добро настроение', links: [['play', 'Най-новото видео', 'https://www.youtube.com/'], ['camera', 'Instagram', 'https://www.instagram.com/'], ['music', 'Подкаст', 'https://open.spotify.com/'], ['bag', 'Моят магазин', MAIL], ['mail', 'За сътрудничество', MAIL]] },
          sections: [] } },
      },
      en: {
        tagline: 'all my links in one place', description: 'Every profile, product and link in one place.',
        nav: [['Links', '/#main'], ['Contact', MAIL]], headerCta: null,
        pages: { index: {
          hero: { center: true, avatar: '★', title: '{{NAME}}', lead: 'Creator · travel, food and good vibes', links: [['play', 'Latest video', 'https://www.youtube.com/'], ['camera', 'Instagram', 'https://www.instagram.com/'], ['music', 'Podcast', 'https://open.spotify.com/'], ['bag', 'My shop', MAIL], ['mail', 'Work with me', MAIL]] },
          sections: [] } },
      },
    },
  },
  // ------------------------------------------------------------------ events & community
  {
    id: 'event', category: 'community', sf: 'ticket', mark: 'mic',
    theme: dark('#0b1020', '#10172b', '#151d36', '#f43f5e', '#8b5cf6', { radius: 16 }),
    lang: {
      bg: {
        tagline: 'конференция 2026', description: 'Един ден, 20 лектори и 500 участници. Вземете билет, докато има ранни цени.',
        nav: [['Програма', '/#schedule'], ['Лектори', '/#speakers'], ['Билети', '/#tickets'], ['Въпроси', '/#faq']], headerCta: ['Вземи билет', '/#tickets'],
        pages: { index: {
          hero: { eyebrow: '14 ноември · София', eyebrowIcon: 'calendar', title: 'Един ден, който <em>променя посоката</em>', lead: '20 лектори, 3 сцени и 500 души, които правят интересни неща. Лекции, работилници и много разговори.', cta: ['Вземи билет', '/#tickets'], cta2: ['Програмата', '/#schedule'],
            card: { icon: 'calendar', title: 'Ранни билети', rows: [['Остават', '87 от 200'], ['Цена', '89 € → 129 €'], ['До', '31 октомври']], note: 'Цената се вдига след ранния период.' } },
          sections: [
            { type: 'stats', items: [['20', 'лектори'], ['3', 'сцени'], ['500', 'участници'], ['12', 'работилници']] },
            { type: 'timeline', id: 'schedule', alt: true, title: 'Програма', items: [['9:00', 'Регистрация и кафе', 'Вземете бадж и намерете познати.'], ['10:00', 'Откриване', 'Защо сме тук и какво следва.'], ['11:00', 'Лекции на три сцени', 'Технологии, дизайн и бизнес.'], ['14:00', 'Работилници', 'Практика в малки групи.'], ['18:00', 'Парти', 'Музика, храна и нетуъркинг.']] },
            { type: 'cards', id: 'speakers', title: 'Лектори', intro: 'Сменете с имената и снимките на лекторите.', items: [['mic', 'Анна Георгиева', 'Продуктов директор · за растежа без хаос.'], ['mic', 'Иван Петков', 'Основател · от гараж до 100 служители.'], ['mic', 'Мария Стоянова', 'Дизайнер · как се прави продукт, който се обича.']] },
            { type: 'pricing', id: 'tickets', alt: true, title: 'Билети', items: [
              { name: 'Стандартен', price: '89 €', per: 'ранна цена', features: ['Всички лекции', 'Обяд и кафе', 'Записи след събитието'], cta: ['Купи', '/#contact'] },
              { name: 'VIP', price: '199 €', per: 'ранна цена', featured: 'Ограничени', features: ['Всичко от стандартния', 'Вечеря с лекторите', 'Места на първите редове'], cta: ['Купи', '/#contact'] },
              { name: 'Екип (5+)', price: '75 €', per: '/ човек', features: ['Отстъпка за групи', 'Една фактура', 'Лого на стената на партньорите'], cta: ['Запитване', '/#contact'] },
            ] },
            { type: 'faq', id: 'faq', title: 'Въпроси', items: [['Мога ли да върна билета?', 'Да, до 14 дни преди събитието — или да го прехвърлите на колега.'], ['Ще има ли записи?', 'Да, всички лекции се записват и се пращат на участниците.'], ['Къде е?', 'В конгресен център в центъра на София, на 5 минути от метро.']] },
            { type: 'contact', id: 'contact', alt: true, title: 'Билети и партньорства', intro: 'Пишете ни за групови билети, спонсорство или участие като лектор.', formName: 'tickets', rows: contactRows('bg', [addr('bg')]), fields: [{ id: 'ticket', label: 'Билет', options: ['Стандартен', 'VIP', 'Екип (5+)', 'Партньорство'] }], messageLabel: 'Съобщение', send: 'Изпрати' },
          ] } },
      },
      en: {
        tagline: 'conference 2026', description: 'One day, 20 speakers and 500 attendees. Get your ticket while early prices last.',
        nav: [['Schedule', '/#schedule'], ['Speakers', '/#speakers'], ['Tickets', '/#tickets'], ['FAQ', '/#faq']], headerCta: ['Get a ticket', '/#tickets'],
        pages: { index: {
          hero: { eyebrow: '14 November · Sofia', eyebrowIcon: 'calendar', title: 'One day that <em>changes direction</em>', lead: '20 speakers, 3 stages and 500 people doing interesting things. Talks, workshops and plenty of conversations.', cta: ['Get a ticket', '/#tickets'], cta2: ['The schedule', '/#schedule'],
            card: { icon: 'calendar', title: 'Early-bird tickets', rows: [['Left', '87 of 200'], ['Price', '€89 → €129'], ['Until', '31 October']], note: 'The price goes up after the early period.' } },
          sections: [
            { type: 'stats', items: [['20', 'speakers'], ['3', 'stages'], ['500', 'attendees'], ['12', 'workshops']] },
            { type: 'timeline', id: 'schedule', alt: true, title: 'Schedule', items: [['9:00', 'Registration and coffee', 'Pick up your badge and find friends.'], ['10:00', 'Opening', 'Why we are here and what comes next.'], ['11:00', 'Talks on three stages', 'Tech, design and business.'], ['14:00', 'Workshops', 'Hands-on in small groups.'], ['18:00', 'Party', 'Music, food and networking.']] },
            { type: 'cards', id: 'speakers', title: 'Speakers', intro: 'Replace with your speakers’ names and photos.', items: [['mic', 'Anna Georgieva', 'Chief product officer · growth without chaos.'], ['mic', 'Ivan Petkov', 'Founder · from a garage to 100 people.'], ['mic', 'Maria Stoyanova', 'Designer · building products people love.']] },
            { type: 'pricing', id: 'tickets', alt: true, title: 'Tickets', items: [
              { name: 'Standard', price: '€89', per: 'early bird', features: ['All talks', 'Lunch and coffee', 'Recordings afterwards'], cta: ['Buy', '/#contact'] },
              { name: 'VIP', price: '€199', per: 'early bird', featured: 'Limited', features: ['Everything in Standard', 'Dinner with the speakers', 'Front-row seats'], cta: ['Buy', '/#contact'] },
              { name: 'Team (5+)', price: '€75', per: '/ person', features: ['Group discount', 'One invoice', 'Logo on the partners wall'], cta: ['Enquire', '/#contact'] },
            ] },
            { type: 'faq', id: 'faq', title: 'FAQ', items: [['Can I get a refund?', 'Yes, up to 14 days before the event — or transfer it to a colleague.'], ['Will there be recordings?', 'Yes, every talk is recorded and sent to attendees.'], ['Where is it?', 'A congress centre in central Sofia, 5 minutes from the metro.']] },
            { type: 'contact', id: 'contact', alt: true, title: 'Tickets and partnerships', intro: 'Write to us about group tickets, sponsorship or speaking.', formName: 'tickets', rows: contactRows('en', [addr('en')]), fields: [{ id: 'ticket', label: 'Ticket', options: ['Standard', 'VIP', 'Team (5+)', 'Partnership'] }], messageLabel: 'Message', send: 'Send' },
          ] } },
      },
    },
  },
  {
    id: 'wedding', category: 'community', sf: 'heart', mark: 'ring',
    theme: light('#fbf8f3', '#f4ede3', '#fffdf9', '#3b2f2a', '#6f625a', '#a47148', '#d4a373', { head: 'serif', font: 'serif', radius: 20, tilt: 0 }),
    lang: {
      bg: {
        tagline: 'нашата сватба', description: 'Поканата, програмата на деня и потвърждение за присъствие.',
        nav: [['Историята', '/#story'], ['Програма', '/#day'], ['Потвърди', '/#rsvp']], headerCta: ['Потвърди присъствие', '/#rsvp'],
        pages: { index: {
          hero: { center: true, eyebrow: '12 юни 2027 · Пловдив', eyebrowIcon: 'heart', title: 'Женим се! <em>Ела с нас</em>', lead: 'Ще се радваме да споделим най-хубавия ни ден с вас. Тук ще намерите програмата, мястото и формата за потвърждение.', cta: ['Потвърди присъствие', '/#rsvp'], cta2: ['Програмата', '/#day'] },
          sections: [
            { type: 'timeline', id: 'story', title: 'Нашата история', items: [['2019', 'Запознаване', 'На рожден ден на общ приятел — и спор за най-хубавия филм.'], ['2022', 'Първото пътуване', 'Две седмици в Италия и една изгубена карта.'], ['2026', 'Годежът', 'На покрива, с изглед към тепетата.']] },
            { type: 'timeline', id: 'day', alt: true, title: 'Програма на деня', items: [['16:00', 'Църковен ритуал', 'Храм „Св. Св. Константин и Елена“.'], ['17:30', 'Граждански ритуал', 'В градината на ресторанта.'], ['19:00', 'Вечеря и празник', 'Музика, танци и много обич — до сутринта.']] },
            { type: 'cards', title: 'Полезно', items: [['pin', 'Място', 'Ресторант „Примерен“, ул. „Примерна“ 1, Пловдив.'], ['home', 'Настаняване', 'Имаме договорени стаи в хотел наблизо — пишете ни.'], ['gift', 'Подаръци', 'Най-големият подарък е да сте с нас.']] },
            { type: 'contact', id: 'rsvp', alt: true, title: 'Потвърди присъствие', intro: 'Моля, потвърдете до 1 май.', formName: 'rsvp', rows: [['phone', 'Телефон', '+359 888 000 000', TEL]], fields: [{ id: 'attending', label: 'Ще дойдете ли?', options: ['Да, с радост', 'За съжаление, не'] }, { id: 'guests', label: 'Брой гости', options: ['1', '2', '3', '4'] }], messageLabel: 'Хранителни предпочитания или пожелание', send: 'Потвърди' },
          ] } },
      },
      en: {
        tagline: 'our wedding', description: 'The invitation, the plan for the day and an RSVP.',
        nav: [['Our story', '/#story'], ['The day', '/#day'], ['RSVP', '/#rsvp']], headerCta: ['RSVP', '/#rsvp'],
        pages: { index: {
          hero: { center: true, eyebrow: '12 June 2027 · Plovdiv', eyebrowIcon: 'heart', title: 'We’re getting married! <em>Join us</em>', lead: 'We would love to share our happiest day with you. Here you will find the plan, the venue and the RSVP form.', cta: ['RSVP', '/#rsvp'], cta2: ['The day', '/#day'] },
          sections: [
            { type: 'timeline', id: 'story', title: 'Our story', items: [['2019', 'We met', 'At a friend’s birthday — and argued about the best film ever.'], ['2022', 'First trip', 'Two weeks in Italy and one lost map.'], ['2026', 'The proposal', 'On a rooftop overlooking the hills.']] },
            { type: 'timeline', id: 'day', alt: true, title: 'The day', items: [['16:00', 'Church ceremony', 'St Constantine and Helena church.'], ['17:30', 'Civil ceremony', 'In the restaurant garden.'], ['19:00', 'Dinner and party', 'Music, dancing and lots of love — until morning.']] },
            { type: 'cards', title: 'Good to know', items: [['pin', 'Venue', 'Primeren Restaurant, 1 Primerna St, Plovdiv.'], ['home', 'Where to stay', 'We have rooms reserved at a hotel nearby — just ask.'], ['gift', 'Gifts', 'Your presence is the greatest gift.']] },
            { type: 'contact', id: 'rsvp', alt: true, title: 'RSVP', intro: 'Please reply by 1 May.', formName: 'rsvp', rows: [['phone', 'Phone', '+359 888 000 000', TEL]], fields: [{ id: 'attending', label: 'Will you come?', options: ['Yes, with joy', 'Sadly, no'] }, { id: 'guests', label: 'Guests', options: ['1', '2', '3', '4'] }], messageLabel: 'Dietary needs or a wish', send: 'Send RSVP' },
          ] } },
      },
    },
  },
  {
    id: 'course', category: 'community', sf: 'graduationcap', mark: 'book',
    theme: light('#f7f8fc', '#eaf4f0', '#ffffff', '#11212d', '#4c5e6b', '#16a34a', '#0ea5e9', { font: 'rounded', radius: 18 }),
    lang: {
      bg: {
        tagline: 'онлайн курс и школа', description: 'Практичен онлайн курс с ментор, домашни и сертификат. Първият урок е безплатен.',
        nav: [['Програма', '/#program'], ['Преподавател', '/#teacher'], ['Цени', '/#plans'], ['Въпроси', '/#faq']], headerCta: ['Запиши се', '/#contact'],
        pages: { index: {
          hero: { eyebrow: 'Нов поток от 3 ноември', eyebrowIcon: 'calendar', title: 'Научете нещо ново <em>за 8 седмици</em>', lead: 'Практичен онлайн курс с живи срещи, ментор и истински проект в портфолиото. Първият урок е безплатен.', cta: ['Запиши се', '/#contact'], cta2: ['Програмата', '/#program'],
            card: { icon: 'book', title: 'Какво получавате', rows: [['Видео уроци', '32'], ['Живи срещи', '8'], ['Сертификат', '✓']], note: 'Достъп до материалите завинаги.' } },
          sections: [
            { type: 'timeline', id: 'program', title: 'Програма', items: [['Седмици 1–2', 'Основи', 'Понятията и инструментите, без които не може.'], ['Седмици 3–5', 'Практика', 'Всяка седмица — малък проект с обратна връзка.'], ['Седмици 6–8', 'Финален проект', 'Ваш собствен проект, който показвате в портфолио.']] },
            { type: 'cards', id: 'teacher', alt: true, title: 'Преподавател', items: [['users', 'Десислава Маринова', '10 години в индустрията, над 2 000 обучени студенти.'], ['star', '4,9 от 5', 'Средна оценка от над 600 отзива.'], ['heart', 'Малки групи', 'До 20 души — всеки получава внимание.']] },
            { type: 'pricing', id: 'plans', title: 'Цени', items: [
              { name: 'Самостоятелно', price: '149 €', features: ['Всички видео уроци', 'Упражнения', 'Сертификат'], cta: ['Запиши се', '/#contact'] },
              { name: 'С ментор', price: '349 €', featured: 'Препоръчан', features: ['Всичко от „Самостоятелно“', '8 живи срещи', 'Преглед на всеки проект'], cta: ['Запиши се', '/#contact'] },
            ] },
            { type: 'faq', id: 'faq', alt: true, title: 'Въпроси', items: [['Нужен ли е опит?', 'Не — започваме от нулата.'], ['Колко време седмично?', 'Около 4–6 часа, в удобно за вас време.'], ['Ако не ми хареса?', 'Връщаме парите до 14 дни след началото.']] },
            { type: 'contact', id: 'contact', title: 'Запиши се', intro: 'Оставете имейл — ще получите безплатния първи урок веднага.', formName: 'enroll', rows: contactRows('bg'), fields: [{ id: 'plan', label: 'План', options: ['Самостоятелно', 'С ментор'] }], messageLabel: 'Въпрос (по избор)', send: 'Запиши ме' },
          ] } },
      },
      en: {
        tagline: 'online course and school', description: 'A practical online course with a mentor, homework and a certificate. The first lesson is free.',
        nav: [['Program', '/#program'], ['Teacher', '/#teacher'], ['Pricing', '/#plans'], ['FAQ', '/#faq']], headerCta: ['Enrol', '/#contact'],
        pages: { index: {
          hero: { eyebrow: 'Next cohort starts 3 November', eyebrowIcon: 'calendar', title: 'Learn something new <em>in 8 weeks</em>', lead: 'A practical online course with live sessions, a mentor and a real project for your portfolio. The first lesson is free.', cta: ['Enrol', '/#contact'], cta2: ['The program', '/#program'],
            card: { icon: 'book', title: 'What you get', rows: [['Video lessons', '32'], ['Live sessions', '8'], ['Certificate', '✓']], note: 'Lifetime access to the materials.' } },
          sections: [
            { type: 'timeline', id: 'program', title: 'Program', items: [['Weeks 1–2', 'Foundations', 'The concepts and tools you cannot do without.'], ['Weeks 3–5', 'Practice', 'A small project with feedback every week.'], ['Weeks 6–8', 'Final project', 'Your own project to show in your portfolio.']] },
            { type: 'cards', id: 'teacher', alt: true, title: 'Your teacher', items: [['users', 'Desislava Marinova', '10 years in the industry, over 2,000 students taught.'], ['star', '4.9 out of 5', 'Average rating from over 600 reviews.'], ['heart', 'Small groups', 'Up to 20 people — everyone gets attention.']] },
            { type: 'pricing', id: 'plans', title: 'Pricing', items: [
              { name: 'Self-paced', price: '€149', features: ['All video lessons', 'Exercises', 'Certificate'], cta: ['Enrol', '/#contact'] },
              { name: 'With a mentor', price: '€349', featured: 'Recommended', features: ['Everything in Self-paced', '8 live sessions', 'Review of every project'], cta: ['Enrol', '/#contact'] },
            ] },
            { type: 'faq', id: 'faq', alt: true, title: 'FAQ', items: [['Do I need experience?', 'No — we start from zero.'], ['How much time per week?', 'About 4–6 hours, whenever suits you.'], ['What if I do not like it?', 'Full refund within 14 days of the start.']] },
            { type: 'contact', id: 'contact', title: 'Enrol', intro: 'Leave your email — the free first lesson arrives right away.', formName: 'enroll', rows: contactRows('en'), fields: [{ id: 'plan', label: 'Plan', options: ['Self-paced', 'With a mentor'] }], messageLabel: 'Question (optional)', send: 'Enrol me' },
          ] } },
      },
    },
  },
  {
    id: 'nonprofit', category: 'community', sf: 'hands.sparkles', mark: 'heart',
    theme: light('#f7faf6', '#ebf3e8', '#ffffff', '#15251a', '#4f6353', '#15803d', '#65a30d', { radius: 18 }),
    lang: {
      bg: {
        tagline: 'кауза, която променя', description: 'Помагаме на деца от малките населени места да учат и мечтаят. Включете се като дарител или доброволец.',
        nav: [['Мисия', '/#mission'], ['Резултати', '/#impact'], ['Включи се', '/#help'], ['Контакт', '/#contact']], headerCta: ['Дари', '/#help'],
        pages: { index: {
          hero: { eyebrow: 'Всяко дарение отива директно за каузата', eyebrowIcon: 'heart', title: 'Заедно даваме <em>шанс на всяко дете</em>', lead: 'Осигуряваме книги, наставници и стипендии за деца от малките населени места. 100% от даренията отиват за програмите.', cta: ['Дари сега', '/#help'], cta2: ['Нашата мисия', '/#mission'],
            card: { icon: 'heart', title: 'Кампания „Книга за всеки“', rows: [['Събрани', '18 400 лв.'], ['Цел', '25 000 лв.'], ['Дарители', '612']], note: 'Остават 18 дни.' } },
          sections: [
            { type: 'cards', id: 'mission', title: 'Нашата мисия', items: [['book', 'Образование', 'Библиотеки и учебни материали за 40 училища.'], ['users', 'Наставници', 'Доброволци, които учат с децата всяка седмица.'], ['star', 'Стипендии', 'Подкрепа за талантливи ученици до университета.']] },
            { type: 'stats', id: 'impact', alt: true, items: [['3 200', 'деца в програмите'], ['40', 'училища'], ['180', 'доброволци'], ['100%', 'от даренията за каузата']] },
            { type: 'pricing', id: 'help', title: 'Как да помогнете', items: [
              { name: 'Еднократно', price: '20 лв.', per: 'или повече', features: ['Книги за един клас', 'Благодарствено писмо', 'Годишен отчет'], cta: ['Дари', '/#contact'] },
              { name: 'Месечно', price: '10 лв.', per: '/ месец', featured: 'Най-голям ефект', features: ['Постоянен наставник за едно дете', 'Новини от програмата', 'Отказ по всяко време'], cta: ['Стани дарител', '/#contact'] },
              { name: 'Доброволец', price: '2 ч.', per: '/ седмица', features: ['Онлайн или на място', 'Обучение и подкрепа', 'Удостоверение'], cta: ['Включи се', '/#contact'] },
            ] },
            { type: 'quotes', alt: true, title: 'Истории', items: [['„Благодарение на наставника си влязох в университет.“', 'Мартин, бивш стипендиант'], ['„Два часа седмично, които ми дават повече, отколкото давам.“', 'Яна, доброволец']] },
            { type: 'contact', id: 'contact', title: 'Контакт', intro: 'Пишете ни за дарения, партньорства или доброволчество.', rows: contactRows('bg', [['shield', 'Банкова сметка', 'BG00 BANK 0000 0000 0000 00']]), send: 'Изпрати' },
          ] } },
      },
      en: {
        tagline: 'a cause that makes a difference', description: 'We help children from small towns learn and dream. Join as a donor or volunteer.',
        nav: [['Mission', '/#mission'], ['Impact', '/#impact'], ['Get involved', '/#help'], ['Contact', '/#contact']], headerCta: ['Donate', '/#help'],
        pages: { index: {
          hero: { eyebrow: 'Every donation goes straight to the cause', eyebrowIcon: 'heart', title: 'Together we give <em>every child a chance</em>', lead: 'We provide books, mentors and scholarships for children in small towns. 100% of donations fund the programs.', cta: ['Donate now', '/#help'], cta2: ['Our mission', '/#mission'],
            card: { icon: 'heart', title: '“A book for everyone” campaign', rows: [['Raised', '€9,400'], ['Goal', '€12,500'], ['Donors', '612']], note: '18 days left.' } },
          sections: [
            { type: 'cards', id: 'mission', title: 'Our mission', items: [['book', 'Education', 'Libraries and learning materials for 40 schools.'], ['users', 'Mentors', 'Volunteers who study with children every week.'], ['star', 'Scholarships', 'Support for talented students all the way to university.']] },
            { type: 'stats', id: 'impact', alt: true, items: [['3,200', 'children in our programs'], ['40', 'schools'], ['180', 'volunteers'], ['100%', 'of donations to the cause']] },
            { type: 'pricing', id: 'help', title: 'How you can help', items: [
              { name: 'One-off', price: '€10', per: 'or more', features: ['Books for one class', 'A thank-you letter', 'Annual report'], cta: ['Donate', '/#contact'] },
              { name: 'Monthly', price: '€5', per: '/ month', featured: 'Biggest impact', features: ['A steady mentor for one child', 'Program news', 'Cancel any time'], cta: ['Become a donor', '/#contact'] },
              { name: 'Volunteer', price: '2 h', per: '/ week', features: ['Online or in person', 'Training and support', 'Certificate'], cta: ['Get involved', '/#contact'] },
            ] },
            { type: 'quotes', alt: true, title: 'Stories', items: [['“Thanks to my mentor I got into university.”', 'Martin, former scholar'], ['“Two hours a week that give me more than I give.”', 'Yana, volunteer']] },
            { type: 'contact', id: 'contact', title: 'Contact', intro: 'Write to us about donations, partnerships or volunteering.', rows: contactRows('en', [['shield', 'Bank account', 'BG00 BANK 0000 0000 0000 00']]), send: 'Send' },
          ] } },
      },
    },
  },
];
