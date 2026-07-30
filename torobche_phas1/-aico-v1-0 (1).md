# **قرارداد فنی — Aico (نسخه‌ی مرتب‌شده بر اساس افراد)**

**این سند مکمل «رودمپ نهایی» است. ساختارش این‌جوریه: اول یه بخش مشترک که همه باید بخونن، بعد برای هر نفر یه بخش جدا با کارهای دقیق خودش، فاز به فاز — این‌که چی می‌سازه، از کی چی می‌گیره، و چی به بقیه تحویل می‌ده.**

**قانون طلایی این سند: اگه حین کار جایی از این قرارداد نیاز به تغییر داشت، همون لحظه توی همین فایل ثبت بشه و به بقیه اطلاع داده بشه.**

# **بخش مشترک — قبل از هر چیز، همه باید این بخش رو بخونن**

## **تصمیمی که باید همون فاز ۰ قطعی بشه**

**جدول‌های&#x20;**&#x6F;rganization&#x73;**,&#x20;**&#x6F;rganization\_member&#x73;**,&#x20;**&#x69;nvite&#x73;**&#x20;ممکنه با پلاگین Organization خود Better Auth همپوشانی داشته باشن. علی باید همون اول فاز ۰ تصمیم بگیره:**

- **مسیر A: جدول‌های سفارشی خودمون (پایین همین سند).**

- **مسیر B: پلاگین Organization و فقط اضافه‌کردن جدول‌هایی که Better Auth نداره.**

**هرکدوم انتخاب شد، همون روز اول باید به بقیه اطلاع داده بشه. تا اون لحظه، همه با فرض «مسیر A» mock می‌زنن.**

## **قوانین طلایی (برای هر ۴ نفر، بدون استثنا)**

1. **پول همیشه سمت سرور محاسبه می‌شه. هیچ‌وقت مبلغ نهایی از کلاینت گرفته و مستقیم ذخیره نشه.**

2. **پول همیشه به‌صورت رشته (string) روی شبکه رد و بدل می‌شه، نه عدد جاوااسکریپتی — برای جلوگیری از خطای اعشار.**

3. **هر خطای مرتبط با پول/سهمیه، یه کد استاندارد داره (پایین‌تر لیست شده) — هیچ صفحه‌ای نباید خطای خام انگلیسی نشون بده.**

4. **کلیدهای حساس (OpenRouter key hash، KEY\_VAULTS\_SECRET) هرگز در لاگ، کد فرانت، یا پیام خطا چاپ نشن.**

5. **تاریخ/زمان همیشه ISO 8601 با UTC روی شبکه رد و بدل می‌شه؛ تبدیل به وقت تهران فقط لحظه‌ی نمایش.**

6. **کد هرکس روی branch جدا (**&#x70;hase-N-<توضیح‌کوتاه>**) و از طریق Pull Request؛ کدهای فاز ۳، ۵، و ۵.۵ (هر چیزی که پول یا کلید امنیتی رو دست می‌زنه) قبل از merge باید توسط یه نفر دیگه (ترجیحاً آرش) ریویو بشه.**

## **قرارداد خطای استاندارد**

**{ code: 'BUDGET\_EXCEEDED', message: 'سهمیه‌ی شما تمام شده است.' }**

**{ code: 'ORG\_WALLET\_EMPTY', message: 'موجودی کیف پول سازمان کافی نیست.' }**

**{ code: 'MODEL\_NOT\_ALLOWED', message: 'دسترسی به این مدل برای شما فعال نیست.' }**

**هر ۴ نفر باید همین کدها رو توی UI خودشون تشخیص بدن و پیام فارسی مناسب نشون بدن.**

## **قرارداد Session (خروجی مهدیار — مصرف همه)**

**session.user = {**

**&#xA0; id: string,**

**&#xA0; name: string | null,**

**&#xA0; email: string | null,**

**&#xA0; emailVerified: boolean,**

**&#xA0; phoneNumber: string | null,**

**&#xA0; phoneNumberVerified: boolean,**

**&#xA0; image: string | null**

**}**

## **Mock Data مشترک (تا فاز ۲/۳ تموم بشه، همه از همین استفاده کنن)**

**{**

**&#xA0; "organization": { "id": "org\_demo1", "name": "شرکت نمونه", "slug": "namoone", "walletBalanceUSD": "500", "status": "active" },**

**&#xA0; "member": {**

**&#xA0;   "id": "mem\_demo1", "userId": "user\_demo1", "name": "علی رضایی", "role": "member", "status": "active",**

**&#xA0;   "budget": { "limitUsd": "10.000000", "usedUsd": "3.245000", "period": "monthly", "isActive": true }**

**&#xA0; },**

**&#xA0; "usageLogs": { "date": "2026-07-20 12:56:20UTC", "tokens":{"input":1012,"output":132,"cache":204} , "costUsd": "0.412000","provider":"ai stordio","Model":"Gemma 4 26B A4B","userId":12,"organizationId":2 }**

**}**

## **نقشه‌ی کلی وابستگی (چه کسی چیزی رو به کی می‌ده)**

| **از**                 | **به**         | **چی**                                      |
| ---------------------- | -------------- | ------------------------------------------- |
| **مهدیار (فاز ۱)**     | **همه**        | **شکل session.user**                        |
| **علی (فاز ۲)**        | **همه**        | **تمام schema دیتابیس + روتر organization** |
| **علی (فاز ۳)**        | **فاز ۴، ۵.۵** | **روتر budget و modelAccess**               |
| **آقای حیدری (فاز ۵)** | **فاز ۴، ۵.۵** | **روتر wallet**                             |
| **آقای حیدری (فاز ۶)** | **فاز ۴، ۵.۵** | **روتر report**                             |

# **۱. علی**

## **فاز ۰ — آماده‌سازی پایه**

**می‌سازه: ریپوی تمیز و قابل‌اجرا، بدون Clerk؛ تصمیم مکتوب درباره‌ی مسیر A/B (بالا). وابسته به: هیچی — این فاز شروع همه‌چیزه. تحویل به بقیه: یه محیط dev سالم که همه روش کار کنن.**

## **فاز ۲ — مدل داده (تمام Schema پروژه اینجا ساخته می‌شه)**

**می‌سازه: تمام جدول‌های جدید زیر، در یک migration واحد (برای جلوگیری از تداخل چند نفر روی فایل schema):**

**organizations | فیلد | نوع | |---|---| | id | text, PK | | name | text, not null | | slug | text, unique | | owner\_user\_id | text, FK به&#x20;**[**user.id**](http://user.id)**&#x20;| | wallet\_balance\_toman | bigint, پیش‌فرض ۰ | | status | enum: active یا suspended، پیش‌فرض active | | created\_at, updated\_at | timestamptz |**

**organization\_members | فیلد | نوع | |---|---| | id | text, PK | | org\_id | text, FK به&#x20;**[**organizations.id**](http://organizations.id)**، cascade | | user\_id | text, FK به&#x20;**[**user.id**](http://user.id)**، cascade | | role | enum: owner یا admin یا member، پیش‌فرض member | | status | enum: invited یا active یا disabled، پیش‌فرض invited | | invited\_by\_user\_id | text, FK، nullable | | joined\_at | timestamptz، nullable | | created\_at, updated\_at | timestamptz | | قید یکتایی | UNIQUE(org\_id, user\_id) |**

**invites | فیلد | نوع | |---|---| | id | text, PK | | org\_id | text, FK | | identifier\_type | enum: phone یا email | | identifier\_value | text | | role | enum: admin یا member | | token | text, unique | | status | enum: pending یا accepted یا expired یا revoked | | invited\_by\_user\_id | text, FK | | expires\_at | timestamptz (۷۲ ساعت پیشنهادی) | | created\_at | timestamptz |**

**member\_budgets | فیلد | نوع | |---|---| | id | text, PK | | org\_member\_id | text, FK، یکتا (هر عضو یک ردیف) | | limit\_usd | numeric(10,6) | | period | enum: daily یا weekly یا monthly یا total | | used\_usd | numeric(10,6)، پیش‌فرض ۰ | | openrouter\_key\_id | text، nullable | | openrouter\_key\_hash | text، nullable — رمزنگاری‌شده | | is\_active | boolean، پیش‌فرض true | | last\_synced\_at | timestamptz، nullable | | created\_at, updated\_at | timestamptz |**

**model\_access\_rules (allow-list — اگه ردیفی نباشه، همه‌ی مدل‌ها مجازن) | فیلد | نوع | |---|---| | id | text, PK | | org\_id | text, FK | | scope | enum: organization یا member | | org\_member\_id | text, FK، nullable (فقط وقتی scope=member) | | model\_id | text | | created\_at | timestamptz |**

**wallet\_transactions (فقط پول ورودی؛ مصرف در usage\_logs ثبت می‌شه) | فیلد | نوع | |---|---| | id | text, PK | | org\_id | text, FK | | type | enum: topup یا manual\_credit یا refund | | amount\_toman | bigint، همیشه مثبت | | gateway\_ref\_id | text، nullable | | description | text، nullable | | created\_by\_user\_id | text، nullable | | created\_at | timestamptz |**

**usage\_logs | فیلد | نوع | |---|---| | id | text, PK | | org\_id, org\_member\_id | text, FK | | model\_id | text | | prompt\_tokens, completion\_tokens, total\_tokens | integer | | cost\_usd | numeric(10,6) | | created\_at | timestamptz |**

**platform\_admins (کاملاً مستقل از نقش‌های سازمانی) | فیلد | نوع | |---|---| | id | text, PK | | user\_id | text, FK، یکتا | | created\_at | timestamptz |**

**همچنین می‌سازه: روتر organization (در src/server/routers/lambda/organization.ts): | Procedure | ورودی | خروجی | |---|---|---| | create | name | id, name, slug | | getMine | — | Organization + myRole | | listMembers | orgId | لیست اعضا | | inviteMember | orgId, identifierType, identifierValue, role | Invite | | acceptInvite | token | orgId | | updateMemberRole | orgId, memberId, role | void | | removeMember | orgId, memberId | void |**

**وابسته به: فاز ۰ (خودش)، شکل session.user از مهدیار. تحویل به بقیه: کل schema بالا + روتر organization.**

## **فاز ۳ — موتور بودجه و OpenRouter (قلب فنی)**

**می‌سازه:**

- **ماژول اتصال به OpenRouter Management API (ساخت/غیرفعال‌سازی کلید per-member)**

- **Cron نظارتی سقف ثانویه**

- **روتر budget:**

| **Procedure**             | **ورودی**                         | **خروجی**                               |
| ------------------------- | --------------------------------- | --------------------------------------- |
| **setMemberBudget**       | **orgMemberId, limitUsd, period** | **MemberBudget**                        |
| **getMemberBudget**       | **orgMemberId**                   | **limitUsd, usedUsd, period, isActive** |
| **disableMemberBudget**   | **orgMemberId**                   | **void**                                |
| **getMemberUsageHistory** | **orgMemberId, from, to**         | **لیست تراکنش‌های مصرف**                |

- **روتر modelAccess:**

| **Procedure**            | **ورودی**                 | **خروجی**             |
| ------------------------ | ------------------------- | --------------------- |
| **setOrgModelAccess**    | **orgId, modelIds**       | **void**              |
| **setMemberModelAccess** | **orgMemberId, modelIds** | **void**              |
| **getAvailableModels**   | **orgMemberId**           | **لیست مدل‌های مجاز** |

**وابسته به: جدول‌های فاز ۲ (خودش). تحویل به بقیه: روترهای budget و modelAccess → مصرف در فاز ۴ و ۵.۵.**

## **فاز ۴ — UI پنل سازمانی (با کمک آرش)**

**می‌سازه: صفحات اعضا، بودجه‌ها، دسترسی مدل‌ها، RBAC UI. وابسته به: روتر organization (خودش)، روترهای budget و modelAccess (خودش)، wallet.getWalletBalance (آقای حیدری)، روتر report (آقای حیدری). تحویل به بقیه: چیزی به فاز دیگه‌ای نمی‌ده — این خروجی نهایی برای مدیر سازمانیه.**

# **۲. مهدیار**

## **فاز ۱ — ورود و احراز هویت (Better Auth)**

**می‌سازه:**

- **راه‌اندازی Better Auth با ایمیل+رمز، GitHub OAuth، پلاگین Phone Number**

- **صفحات ورود/ثبت‌نام/وریفای شماره**

- **دو تابع کمکی (بعد از این‌که schema فاز ۲ حاضر شد، تکمیلشون کن):**

  - **getCurrentOrgRole(userId, orgId) → owner یا admin یا member یا null**

  - **isPlatformAdmin(userId) → true یا false**

**سناریوهایی که باید تست بشن: ثبت‌نام/ورود با ایمیل، ثبت‌نام/ورود با GitHub، لینک‌کردن GitHub به حساب ایمیلی موجود، وریفای اجباری شماره برای مدیر/خریدار مستقل، عبور بدون وریفای شماره برای عضو عادی، خطای OTP اشتباه/منقضی/rate-limit، خروج و ورود مجدد.**

**وابسته به: فاز ۰ (محیط پایه از علی). تابع getCurrentOrgRole به‌طور کامل به schema فاز ۲ وابسته‌ست — تا اون موقع، نسخه‌ی موقتش همیشه null برگردونه. تحویل به بقیه: شکل session.user + دو تابع کمکی → مصرف در فاز ۴ و ۵.۵ برای کنترل دسترسی.**

# **۳. آرش**

## **فاز ۵.۵ — پنل مدیریت خود بیزنس (Super Admin)**

**می‌سازه: روتر platformAdmin:**

| **Procedure**                                  | **ورودی**                           | **خروجی**                                                  |
| ---------------------------------------------- | ----------------------------------- | ---------------------------------------------------------- |
| **listOrganizations**                          | **page**                            | **لیست سازمان‌ها با مجموع مصرف**                           |
| **suspendOrganization / activateOrganization** | **orgId**                           | **void**                                                   |
| **addManualCredit**                            | **orgId, amountToman, description** | **WalletTransaction**                                      |
| **getPlatformFinancials**                      | **from, to**                        | **totalRevenueToman, totalOpenRouterCostUsd, marginToman** |
| **getMasterAccountStatus**                     | **—**                               | **balanceUsd, belowThreshold**                             |

**و صفحات UI مربوطه (لیست سازمان‌ها، کیف پول مشتریان، مانیتورینگ حساب مرکزی OpenRouter، گزارش مالی).**

**وابسته به: schema فاز ۲ (organizations، wallet\_transactions) از علی، روترهای budget و modelAccess (فاز ۳)، روتر wallet و report (آقای حیدری، فاز ۵ و ۶). می‌تونه زودتر شروع کنه: با mock data (بخش مشترک بالا)، همزمان با فاز ۲-۳، بدون معطلی. تحویل به بقیه: چیزی به فاز دیگه نمی‌ده — این پنل فقط برای تیم داخلیه.**

## **کمک در فاز ۴ — UI پنل سازمانی**

**با علی همکاری می‌کنه؛ قرارداد دقیقش همون چیزیه که بالا زیر «فاز ۴» نوشته شده.**

# **۴. آقای حیدری**

## **فاز ۵ — کیف پول سازمانی و پرداخت ریالی**

**می‌سازه:**

- **درگاه زرین‌پال + مسیر callback (یک Route Handler معمولی، نه tRPC، چون درگاه مستقیم بهش ریدایرکت می‌کنه)**

- **روتر wallet:**

| **Procedure**             | **ورودی**              | **خروجی**          |
| ------------------------- | ---------------------- | ------------------ |
| **initiateTopup**         | **orgId, amountToman** | **paymentUrl**     |
| **getWalletBalance**      | **orgId**              | **balanceToman**   |
| **getTransactionHistory** | **orgId, from, to**    | **لیست تراکنش‌ها** |

**وابسته به: جدول‌های organizations.wallet\_balance\_toman و wallet\_transactions (علی، فاز ۲). تحویل به بقیه: روتر wallet → مصرف در فاز ۴ و ۵.۵.**

## **فاز ۶ — داشبورد گزارش‌گیری**

**می‌سازه: روتر report:**

| **Procedure**           | **ورودی**                              | **خروجی**            |
| ----------------------- | -------------------------------------- | -------------------- |
| **getMemberUsageChart** | **orgMemberId, from, to, granularity** | **لیست نقاط نمودار** |
| **getOrgUsageChart**    | **orgId, from, to, granularity**       | **لیست نقاط نمودار** |

**وابسته به: جدول usage\_logs (علی، فاز ۳). تحویل به بقیه: روتر report → مصرف در فاز ۴ و ۵.۵.**

# **مشترک همه — فازهای پایانی**

**فاز ۷ (فارسی‌سازی): فارسی سازی نهایی صفحات (آرش + علی + مهدیار). فاز ۸ (QA): هر ۴ نفر با هم، تست end-to-end. فاز ۹ (استقرار): علی + آرش.**

**جزئیات «چیه / هدف نهایی / کِی تموم شده» هر فاز، همون چیزیه که در سند «رودمپ نهایی» نوشته شده — این سند فقط قرارداد فنی (schema و API) بین بخش‌هاست، جای رودمپ رو نمی‌گیره.**
