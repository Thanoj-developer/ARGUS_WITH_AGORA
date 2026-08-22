/**
 * Human-In-The-Loop (HITL) helper functions.
 */

/**
 * Detects if any element in the accessibility tree is an OTP/2FA input field.
 *
 * @param {Array} elementsList - List of interactive accessibility elements on the page.
 * @returns {Object|null} - The element details if OTP field is detected, otherwise null.
 */
function checkForOtpInput(elementsList) {
  if (!elementsList || !Array.isArray(elementsList)) return null;

  const otpKeywords = [
    'otp',
    'one-time',
    'one time',
    '2fa',
    'verification code',
    'verification-code',
    'security code',
    'mfa',
    'passcode'
  ];

  for (const el of elementsList) {
    const role = (el.role || '').toLowerCase();
    const name = (el.name || '').toLowerCase();
    
    // Check if it's a textbox or input-like field
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox') {
      const isCard = name.includes('card') || name.includes('cvv') || name.includes('cvc') || name.includes('credit');
      const isOtp = otpKeywords.some(keyword => name.includes(keyword)) && !isCard;
      // Skip if the field is already filled with a value
      const hasValue = el.value !== undefined && el.value !== null && String(el.value).trim().length > 0;
      if (isOtp && !hasValue) {
        return {
          index: el.index,
          name: el.name,
          role: el.role,
          selector: el.selector
        };
      }
    }
  }

  return null;
}

function checkForUnavailableFields(elementsList, piiData) {
  if (!elementsList || !Array.isArray(elementsList) || !piiData) return null;

  for (const el of elementsList) {
    const role = (el.role || '').toLowerCase();
    if (role !== 'textbox' && role !== 'searchbox' && role !== 'combobox') continue;

    // Helper to resolve clean field name
    const htmlName = (el.selector && el.selector.match(/name=["'](.*?)["']/i)) 
      ? el.selector.match(/name=["'](.*?)["']/i)[1].replace(/\\3(\d)\s?/g, '$1').toLowerCase() 
      : '';
    const name = htmlName || (el.name || '').toLowerCase();

    // Map known forms inputs to PII structure checks
    if (name.includes('first name') || name.includes('firstname') || name.includes('frstname') || name === 'first-name') {
      if (!piiData.first_name) return { index: el.index, name: 'First Name' };
    }
    else if (name.includes('last name') || name.includes('lastname') || name === 'last-name') {
      if (!piiData.last_name) return { index: el.index, name: 'Last Name' };
    }
    else if (name.includes('company') || name === 'company' || name.includes('05_company')) {
      if (!piiData.company) return { index: el.index, name: 'Company Name' };
    }
    else if (name.includes('address1') || name.includes('address 1') || name.includes('addr1') || name.includes('street') || name.includes('address_1')) {
      if (!piiData.address?.line1) return { index: el.index, name: 'Address Line 1' };
    }
    else if (name.includes('city') || name.includes('town') || name.includes('adr_city')) {
      if (!piiData.address?.city) return { index: el.index, name: 'City' };
    }
    else if (name.includes('zip') || name.includes('postal') || name.includes('postcode') || name.includes('addr_zip')) {
      if (!piiData.address?.zip) return { index: el.index, name: 'Zip/Postal Code' };
    }
    else if (name.includes('emailadr') || name.includes('email') || name.includes('e-mail')) {
      if (!piiData.contact?.email) return { index: el.index, name: 'Email Address' };
    }
    else if (name.includes('cellphon') || name.includes('mobile') || name.includes('cell phone')) {
      if (!piiData.contact?.cell_phone) return { index: el.index, name: 'Mobile Phone Number' };
    }
    else if (name.includes('ccexp_mm') || name.includes('exp_mm') || name.includes('42ccexp_mm')) {
      if (!piiData.payment?.card_expiration_date?.month) return { index: el.index, name: 'Credit Card Expiration Month' };
    }
    else if (name.includes('ccexp_yy') || name.includes('exp_yy') || name.includes('43ccexp_yy')) {
      if (!piiData.payment?.card_expiration_date?.year) return { index: el.index, name: 'Credit Card Expiration Year' };
    }
    else if (name.includes('ccnumber') || name.includes('card number') || name.includes('41ccnumber')) {
      if (!piiData.payment?.credit_card_number) return { index: el.index, name: 'Credit Card Number' };
    }
    else if (name.includes('ccv_code') || name.includes('cvv') || name.includes('cvc') || name.includes('43ccv_code')) {
      if (!piiData.payment?.card_verification_code) return { index: el.index, name: 'Credit Card CVV/Security Code' };
    }
  }

  return null;
}

module.exports = {
  checkForOtpInput,
  checkForUnavailableFields
};
