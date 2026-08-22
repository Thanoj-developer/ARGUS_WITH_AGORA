/**
 * Multi-Field Form Filling Module.
 * Maps elements in the accessibility tree to values in PII.json.
 */

function getHtmlAttributeName(el) {
  if (!el.selector) return '';
  const match = el.selector.match(/name=["'](.*?)["']/i);
  if (match) {
    // Decode escape sequences like \30, \31, etc.
    return match[1].replace(/\\3(\d)\s?/g, '$1');
  }
  return '';
}

function getElementFieldName(el) {
  const htmlName = getHtmlAttributeName(el);
  if (htmlName) {
    return htmlName.toLowerCase();
  }
  return (el.name || '').toLowerCase();
}

function isMonthDropdown(name) {
  const n = name.toLowerCase();
  // Matches "month", shorthand "mm", month names, or list of numbers 01 to 12
  const hasMonthKeywords = /month|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(n);
  const hasMmShorthand = /(\b|_|\d|exp)mm(\b|_)/i.test(n) || n === 'mm';
  
  // Check if name is exactly or contains a list of numbers from 01 to 12
  const has01to12 = /\b(01|02|03|04|05|06|07|08|09|10|11|12)\b/g.test(n) && 
                    !/\b(13|14|15|16|17|18|19|20|21|22|23|24|25|26|27|28|29|30|31)\b/.test(n);

  return hasMonthKeywords || hasMmShorthand || has01to12;
}

function isYearDropdown(name) {
  const n = name.toLowerCase();
  // Matches "year", shorthand "yy", or 4-digit years
  const hasYearKeywords = /year/i.test(n);
  const hasYyShorthand = /(\b|_|\d|exp)yy(\b|_)/i.test(n) || n === 'yy';
  const has4DigitYears = /\b(19\d{2}|20\d{2})\b/.test(n);

  return hasYearKeywords || hasYyShorthand || has4DigitYears;
}

function isDayDropdown(name) {
  const n = name.toLowerCase();
  // Matches "day", shorthand "dd", or day lists up to 31
  const hasDayKeywords = /day|date/i.test(n);
  const hasDdShorthand = /(\b|_|\d)dd(\b|_)/i.test(n) || n === 'dd';
  const hasDaysLimit = /\b(13|14|15|16|17|18|19|20|21|22|23|24|25|26|27|28|29|30|31)\b/.test(n) && 
                       !/\b(20\d{2}|19\d{2})\b/.test(n);

  return hasDayKeywords || hasDdShorthand || hasDaysLimit;
}

function checkForFormFilling(elementsList, piiData) {
  if (!elementsList || !Array.isArray(elementsList) || !piiData) {
    return null;
  }

  const fills = [];

  // Group month/day/year selects to resolve ambiguous DOB vs Card Expiry fields
  const monthSelects = [];
  const yearSelects = [];
  const daySelects = [];

  elementsList.forEach(el => {
    const role = (el.role || '').toLowerCase();
    if (role === 'combobox') {
      const fieldName = getElementFieldName(el);
      if (isMonthDropdown(fieldName)) {
        monthSelects.push(el);
      } else if (isYearDropdown(fieldName)) {
        yearSelects.push(el);
      } else if (isDayDropdown(fieldName)) {
        daySelects.push(el);
      }
    }
  });

  elementsList.forEach(el => {
    const role = (el.role || '').toLowerCase();
    const index = el.index;
    const name = getElementFieldName(el);

    // 1. Text Fields (Fill Action)
    if (role === 'textbox' || role === 'searchbox') {
      let value = null;

      // First Name
      if (name.includes('first name') || name.includes('firstname') || name.includes('frstname') || name === 'first-name') {
        value = piiData.first_name;
      }
      // Middle Initial / Name
      else if (name.includes('middle initial') || name.includes('middle name') || name === 'middle-name' || name.includes('middle_i') || name === 'initial') {
        value = piiData.middle_initial;
      }
      // Last Name
      else if (name.includes('last name') || name.includes('lastname') || name === 'last-name') {
        value = piiData.last_name;
      }
      // Full Name
      else if (name.includes('full name') || name.includes('fullname') || name === 'full-name' || name === 'name') {
        value = piiData.full_name;
      }
      // Company / Position
      else if (name.includes('company') || name.includes('organization') || name.includes('employer')) {
        value = piiData.company;
      }
      else if (name.includes('position') || name.includes('job title') || name.includes('jobtitle')) {
        value = piiData.position;
      }
      // Address lines
      else if (name.includes('address line 1') || name.includes('address1') || name === 'address line1' || name === 'street address') {
        value = piiData.address?.line1;
      }
      else if (name.includes('address line 2') || name.includes('address2') || name === 'address line2' || name === 'suite' || name === 'apt' || name === 'apartment') {
        value = piiData.address?.line2;
      }
      // City / State / Country / Zip
      else if (name === 'city' || name.includes('city') || name.includes('adr_city')) {
        value = piiData.address?.city;
      }
      else if (name.includes('state') || name.includes('province') || name.includes('region') || name.includes('adrstate')) {
        value = piiData.address?.state_province;
      }
      else if (name.includes('country')) {
        value = piiData.address?.country;
      }
      else if (name === 'zip' || name.includes('zip') || name.includes('postal') || name.includes('pincode') || name.includes('postcode') || name.includes('addr_zip')) {
        value = piiData.address?.zip;
      }
      // Phone numbers / E-mail
      else if (name.includes('home phone') || name.includes('home telephone') || name.includes('homephon')) {
        value = piiData.contact?.home_phone;
      }
      else if (name.includes('work phone') || name.includes('work telephone') || name.includes('workphon')) {
        value = piiData.contact?.work_telephone;
      }
      else if (name.includes('fax')) {
        value = piiData.contact?.fax;
      }
      else if (name.includes('cell phone') || name.includes('cellphone') || name.includes('cellphon') || name.includes('mobile')) {
        value = piiData.contact?.cell_phone;
      }
      else if (name.includes('phone') || name.includes('telephone') || name.includes('contact')) {
        value = piiData.contact?.cell_phone || piiData.contact?.home_phone;
      }
      else if (name.includes('email') || name.includes('e-mail') || name.includes('mail address') || name === 'mail' || name.includes('emailadr')) {
        value = piiData.contact?.email;
      }
      else if (name.includes('website') || name.includes('web site') || name === 'url' || name === 'homepage' || name.includes('web_site')) {
        value = piiData.contact?.website;
      }
      // Security password
      else if (name.includes('password') || name === 'pass') {
        value = piiData.security?.password;
      }
      // Payment Card Details
      else if (name.includes('credit card number') || name.includes('card number') || name.includes('cc number') || name === 'cardnumber' || name.includes('ccnumber')) {
        value = piiData.payment?.credit_card_number;
      }
      else if (name.includes('verification code') || name.includes('cvv') || name.includes('cvc') || name.includes('security code')) {
        value = piiData.payment?.card_verification_code;
      }
      else if (name.includes('card user name') || name.includes('cardname') || name.includes('name on card') || name.includes('cc_uname')) {
        value = piiData.payment?.card_user_name;
      }
      else if (name.includes('issuing bank') || name.includes('bank name') || name.includes('card bank') || name.includes('ccissuer')) {
        value = piiData.payment?.card_issuing_bank;
      }
      else if (name.includes('customer service phone') || name.includes('bank phone') || name.includes('service phone') || name.includes('cccstsvc')) {
        value = piiData.payment?.card_customer_service_phone;
      }
      // Personal Details
      else if (name === 'sex' || name === 'gender' || name.includes('pers_sex')) {
        value = piiData.personal_details?.sex;
      }
      else if (name.includes('social security') || name.includes('ssn') || name.includes('pers_ssn')) {
        value = piiData.personal_details?.social_security_number;
      }
      else if (name.includes('driver license') || name.includes('license number') || name.includes('driver\'s license') || name.includes('driv_lic')) {
        value = piiData.personal_details?.driver_license_number;
      }
      else if (name === 'age' || name.includes('pers_age')) {
        value = piiData.personal_details?.age;
      }
      else if (name.includes('birth place') || name.includes('birthplace') || name.includes('place of birth') || name.includes('birth_pl')) {
        value = piiData.personal_details?.birth_place;
      }
      else if (name.includes('income') || name.includes('salary')) {
        value = piiData.personal_details?.income;
      }
      // Additional Info
      else if (name.includes('custom message') || name === 'message' || name.includes('__custom')) {
        value = piiData.additional_info?.custom_message;
      }
      else if (name.includes('comments') || name === 'comment' || name.includes('__commnt')) {
        value = piiData.additional_info?.comments;
      }

      if (value !== undefined && value !== null) {
        let selector = el.selector;
        if (name) {
          selector = `input[name="${name}"]`;
        }
        fills.push({
          index: index,
          action: 'fill',
          value: String(value),
          name: el.name || name,
          selector: selector
        });
      }
    }

    // 2. Select Fields (Select Action)
    else if (role === 'combobox') {
      let value = null;

      if (name.includes('card type') || name.includes('credit card type') || name.includes('cc__type')) {
        value = piiData.payment?.credit_card_type;
      }
      // Ambiguous Month Selects
      else if (isMonthDropdown(name)) {
        const orderIndex = monthSelects.findIndex(item => item.index === el.index);
        if (orderIndex === 0) {
          // First month select is likely Card Expiration Month
          value = piiData.payment?.card_expiration_date?.month;
        } else {
          // Second month select is likely Date of Birth Month
          value = piiData.personal_details?.date_of_birth?.month;
        }
      }
      // Ambiguous Year Selects
      else if (isYearDropdown(name)) {
        const orderIndex = yearSelects.findIndex(item => item.index === el.index);
        if (orderIndex === 0) {
          // First year select is likely Card Expiration Year
          value = piiData.payment?.card_expiration_date?.year;
        } else {
          // Second year select is likely Date of Birth Year
          value = piiData.personal_details?.date_of_birth?.year;
        }
      }
      // Ambiguous Day Selects
      else if (isDayDropdown(name)) {
        value = piiData.personal_details?.date_of_birth?.day;
      }

      if (value !== undefined && value !== null) {
        let selector = el.selector;
        if (name) {
          selector = `select[name="${name}"]`;
        }
        fills.push({
          index: index,
          action: 'select',
          value: String(value),
          name: el.name || name,
          selector: selector
        });
      }
    }
  });

  if (fills.length > 0) {
    return {
      action: 'multi_fill',
      fills: fills
    };
  }

  return null;
}

/**
 * Executes a batch of UI actions generated by the LLM.
 * 
 * @param {import('playwright').Page} page - Playwright page instance
 * @param {Object} selectorMap - The ASSIGNED SELECTOR INDEX MAP JSON
 * @param {Array} actions - Array of LLM-generated action objects
 */
async function executeBatchActions(page, selectorMap, actions) {
  for (const actionItem of actions) {
    const target = selectorMap[actionItem.index?.toString()];
    const selector = actionItem.selector || target?.selector;

    if (!selector) {
      console.warn(`[Automation] Selector index ${actionItem.index} not found in map. Skipping.`);
      continue;
    }

    try {
      const locator = page.locator(selector).first();
      await locator.scrollIntoViewIfNeeded().catch(() => {});

      if (actionItem.action === "fill") {
        await locator.fill(actionItem.value);
        console.log(`[Success] Filled Index ${actionItem.index} (${(target && target.name) || selector})`);
      } 
      else if (actionItem.action === "select" || actionItem.action === "selectOption") {
        await locator.selectOption({ label: actionItem.value }).catch(async () => {
          // Fallback if label match fails: attempt value match
          await locator.selectOption(actionItem.value);
        });
        console.log(`[Success] Selected Index ${actionItem.index}`);
      }
      else if (actionItem.action === "click") {
        await locator.click();
        console.log(`[Success] Clicked Index ${actionItem.index}`);
      }
    } catch (err) {
      console.error(`[Error] Failed to execute action on Index ${actionItem.index}:`, err.message);
    }
  }
}

/**
 * Pre-processes the selector map/list for the LLM.
 * Cleans CSS hex escapes and extracts field hints.
 *
 * @param {Object|Array} input - Selector map or elements list
 * @returns {Array} - Cleaned elements list for LLM consumption
 */
function preprocessSelectorMap(input) {
  const elements = Array.isArray(input) ? input : Object.values(input || {});
  const cleanedList = [];

  const interactiveRoles = new Set([
    'textbox', 'combobox', 'searchbox', 'listbox',
    'button', 'link', 'checkbox', 'radio', 'tab', 'menuitem'
  ]);

  for (const item of elements) {
    const role = (item.role || '').toLowerCase();
    if (!interactiveRoles.has(role)) {
      continue;
    }

    // Unescape CSS hex codes like "\\30 2frstname" -> "02frstname" -> "frstname"
    const selectorStr = item.selector || '';
    let cleanName = selectorStr
      .replace(/\\3(\d)\s?/g, '$1') // Removes CSS hex encoding prefix
      .replace(/input\[name="|"\]|select\[name="|"\]/g, ''); // Extracts clean field name

    cleanedList.push({
      index: item.index,
      role: item.role,
      field_hint: cleanName || null,
      selector: item.selector,
      name: item.name || null,
      playCode: item.playCode || ''
    });
  }

  return cleanedList;
}

module.exports = {
  checkForFormFilling,
  executeBatchActions,
  preprocessSelectorMap
};
