import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Linking,
} from 'react-native';
import { router } from 'expo-router';
import {
  collection,
  doc,
  setDoc,
  query,
  orderBy,
  limit,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { Colors } from '../constants/colors';
import { VERSION } from '../constants/version';

const RATE_TYPES = ['Conventional', 'FHA', 'VA', 'USDA', 'Jumbo', 'Non-QM'];
const DEFAULT_CHECKED = ['Conventional', 'FHA', 'VA'];

interface RateData {
  date: string;
  conventional?: { rate: number; apr: number };
  fha?: { rate: number; apr: number };
  va?: { rate: number; apr: number };
  usda?: { rate: number; apr: number };
  jumbo?: { rate: number; apr: number };
  nonqm?: { rate: number; apr: number };
}

export default function HomeScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [zip, setZip] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<string[]>(DEFAULT_CHECKED);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [rates, setRates] = useState<RateData | null>(null);
  const [loadingRates, setLoadingRates] = useState(true);

  useEffect(() => {
    fetchLatestRates();
  }, []);

  async function fetchLatestRates() {
    try {
      const q = query(collection(db, 'rateHistory'), orderBy('date', 'desc'), limit(1));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        setRates(snapshot.docs[0].data() as RateData);
      }
    } catch (err) {
      console.log('No rates yet');
    } finally {
      setLoadingRates(false);
    }
  }

  function toggleType(type: string) {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }

  async function handleSubmit() {
    setError('');

    if (!email.trim()) {
      setError('Email is required.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }

    if (!phone.trim() || phone.trim().replace(/\D/g, '').length < 10) {
      setError('Phone number is required (10 digits).');
      return;
    }

    if (selectedTypes.length === 0) {
      setError('Select at least one rate type.');
      return;
    }

    setSubmitting(true);

    // Honeypot check — bots fill hidden fields
    if (honeypot) {
      // Fake success, don't save
      setTimeout(() => {
        setSubmitting(false);
        setSubmitted(true);
      }, 800);
      return;
    }

    try {
      const emailKey = email.trim().toLowerCase();
      const emailDomain = emailKey.split('@')[1] || '';

      // Competitor detection: exact domains + keyword patterns
      const COMPETITOR_DOMAINS = [
        // National lenders
        'rocketmortgage.com', 'quickenloans.com', 'uwm.com', 'unitedwholesale.com',
        'loandepot.com', 'wellsfargo.com', 'chase.com', 'bankofamerica.com',
        'caliberhomeloans.com', 'pennymac.com', 'freedommortgage.com', 'newrez.com',
        'flagstar.com', 'crosscountrymortgage.com', 'movement.com',
        'fairwayindependentmc.com', 'guildmortgage.com', 'homepoint.com',
        'rate.com', 'mrcooper.com', 'dhimortgage.com', 'lennarmortgage.com',
        'citizensbank.com', 'pnc.com', 'truist.com', 'usbank.com',
        'amerihome.com', 'guaranteed-rate.com', 'primeres.com',
        'carringtonmortgage.com', 'nationstar.com',
        // Huntsville / local
        'midtownmtg.com', 'riverbankandtrust.com', 'assurancemortgage.com',
        'planethomelending.com', 'regions.com', 'capitalhomemortgage.com',
        'northalabamamortgage.com', 'dsldmortgage.com', 'redfcu.org',
        'alabamacu.com', 'avadiancu.com', 'ucbi.com', 'bryantbank.com',
        'nova.bank', 'mylocal.bank', 'cbsbank.com', 'cadencebank.com',
        'bankindependent.com', 'worthingtonmortgage.com', 'hometownlenders.com',
        'cishomeloans.com', 'supremelending.com', '1stfamilymortgage.com',
      ];
      // Keyword patterns — flag if domain contains any of these
      const COMPETITOR_KEYWORDS = ['mortgage', 'loan', 'lender', 'lending', 'rate', 'bank', 'credit'];
      const domainLower = emailDomain.toLowerCase();
      const domainBase = domainLower.split('.')[0]; // e.g., 'rocketmortgage' from 'rocketmortgage.com'
      const isCompetitor = COMPETITOR_DOMAINS.some(d => domainLower === d) ||
        COMPETITOR_KEYWORDS.some(kw => domainBase.includes(kw));

      await setDoc(doc(db, 'subscribers', emailKey), {
        name: name.trim(),
        email: emailKey,
        phone: phone.trim(),
        zip: zip.trim(),
        rateTypes: selectedTypes,
        active: true,
        flagged: isCompetitor,
        createdAt: serverTimestamp(),
      }, { merge: true });

      // Alert Roby on every signup
      try {
        await fetch('/api/alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: emailKey, name: name.trim(), phone: phone.trim(), domain: emailDomain, isCompetitor, rateTypes: selectedTypes }),
        });
      } catch {} // Silent — don't block signup
      setSubmitted(true);
    } catch (err) {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const RATE_CAVEATS: Record<string, string> = {
    'Conventional': '780 FICO, 20% down, $300K purchase, 30yr fixed',
    'FHA': '780 FICO, 5% down, $300K purchase, 30yr fixed, incl. MIP',
    'VA': '780 FICO, 0% down, $300K purchase, 30yr fixed, exempt',
    'USDA': '780 FICO, 0% down, $300K purchase, 30yr fixed, incl. guarantee fee',
    'Jumbo': '780 FICO, 20% down, $1,062,500 purchase, 30yr fixed',
    'Non-QM': '780 FICO, 20% down, $375K purchase, 30yr fixed, full doc',
  };

  function renderRateRow(label: string, data?: { rate: number; apr: number }) {
    if (!data) return null;
    return (
      <View style={styles.rateRowBlock}>
        <View style={styles.rateRow}>
          <Text style={styles.rateLabel}>{label}</Text>
          <Text style={styles.rateValue}>{data.rate.toFixed(3)}%</Text>
          <Text style={styles.rateApr}>APR {data.apr ? data.apr.toFixed(2) + '%' : 'N/A'}</Text>
        </View>
        <Text style={styles.rateCaveat}>{RATE_CAVEATS[label] || ''}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.logo}>RateBlaster</Text>
        <Text style={styles.tagline}>Daily Mortgage Rates, Delivered.</Text>
      </View>

      {/* Signup Section */}
      <View style={styles.card}>
        {submitted ? (
          <View style={styles.successBox}>
            <Text style={styles.successIcon}>✓</Text>
            <Text style={styles.successTitle}>You're in!</Text>
            <Text style={styles.successText}>
              Watch your inbox for tomorrow's rates.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Sign Up for Free</Text>
            <Text style={styles.sectionSubtitle}>
              Get today's best mortgage rates delivered to your inbox every morning.
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="John Smith"
                placeholderTextColor={Colors.textSecondary}
                autoCapitalize="words"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email *</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="john@example.com"
                placeholderTextColor={Colors.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Phone Number *</Text>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                placeholder="(256) 555-1234"
                placeholderTextColor={Colors.textSecondary}
                keyboardType="phone-pad"
                maxLength={14}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Zip Code</Text>
              <TextInput
                style={styles.input}
                value={zip}
                onChangeText={setZip}
                placeholder="35801"
                placeholderTextColor={Colors.textSecondary}
                keyboardType="number-pad"
                maxLength={5}
              />
            </View>

            {/* Honeypot - hidden from humans */}
            {Platform.OS === 'web' ? (
              <View
                style={{ position: 'absolute', left: -9999, top: -9999, opacity: 0 }}
                aria-hidden="true"
              >
                <TextInput
                  value={honeypot}
                  onChangeText={setHoneypot}
                  tabIndex={-1}
                  autoComplete="off"
                />
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Rate Types</Text>
              <View style={styles.checkboxGroup}>
                {RATE_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={styles.checkboxRow}
                    onPress={() => toggleType(type)}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        selectedTypes.includes(type) && styles.checkboxChecked,
                      ]}
                    >
                      {selectedTypes.includes(type) && (
                        <Text style={styles.checkmark}>✓</Text>
                      )}
                    </View>
                    <Text style={styles.checkboxLabel}>{type}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.button, submitting && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
              activeOpacity={0.8}
            >
              {submitting ? (
                <ActivityIndicator color={Colors.textLight} />
              ) : (
                <Text style={styles.buttonText}>Subscribe</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Today's Rates */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Today's Rates</Text>
        {loadingRates ? (
          <ActivityIndicator color={Colors.primary} style={{ marginVertical: 20 }} />
        ) : rates ? (
          <>
            <Text style={styles.rateDate}>{rates.date}</Text>
            <View style={styles.rateTable}>
              <View style={styles.rateHeaderRow}>
                <Text style={[styles.rateLabel, styles.rateHeaderText]}>Type</Text>
                <Text style={[styles.rateValue, styles.rateHeaderText]}>Rate</Text>
                <Text style={[styles.rateApr, styles.rateHeaderText]}>APR</Text>
              </View>
              {renderRateRow('Conventional', rates.conventional)}
              {renderRateRow('FHA', rates.fha)}
              {renderRateRow('VA', rates.va)}
              {renderRateRow('USDA', rates.usda)}
              {renderRateRow('Jumbo', rates.jumbo)}
              {renderRateRow('Non-QM', rates.nonqm)}
            </View>
            <Text style={styles.rateDisclaimer}>
              * Rates/APR based on current day market, subject to change without notice. Rates shown are for informational purposes only and do not constitute a loan commitment. Actual rates may vary based on borrower qualifications, property type, and market conditions. Contact a loan officer for a personalized quote.
            </Text>
          </>
        ) : (
          <Text style={styles.noRates}>Rates coming soon!</Text>
        )}
      </View>

      {/* Action Buttons */}
      <View style={styles.buttonCard}>
        <TouchableOpacity
          style={styles.historyButton}
          onPress={() => router.push('/history')}
          activeOpacity={0.7}
        >
          <Text style={styles.historyButtonText}>View Rate History</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.calcButton}
          onPress={() => Linking.openURL('https://www.dorsettgroup.com/mortgage-calculator.html')}
          activeOpacity={0.7}
        >
          <Text style={styles.calcButtonText}>Mortgage Calculator</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.applyButton}
          onPress={() => Linking.openURL('https://roby.zipforhome.com/')}
          activeOpacity={0.7}
        >
          <Text style={styles.applyButtonText}>Apply Now</Text>
        </TouchableOpacity>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Powered by The McAbee Group | NMLS 196893 (v{VERSION})
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingBottom: 40,
  },
  header: {
    backgroundColor: Colors.primary,
    paddingTop: Platform.OS === 'web' ? 60 : 80,
    paddingBottom: 40,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  logo: {
    fontSize: 36,
    fontWeight: '800',
    color: Colors.textLight,
    letterSpacing: 1,
  },
  tagline: {
    fontSize: 16,
    color: Colors.accent,
    marginTop: 8,
    fontWeight: '500',
  },
  card: {
    backgroundColor: Colors.surface,
    marginHorizontal: 16,
    marginTop: 20,
    borderRadius: 12,
    padding: 24,
    ...Platform.select({
      web: {
        maxWidth: 520,
        alignSelf: 'center' as const,
        width: '100%',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      default: {
        elevation: 3,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
    }),
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 20,
    lineHeight: 20,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  checkboxGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '48%',
    paddingVertical: 6,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: Colors.border,
    borderRadius: 4,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  checkmark: {
    color: Colors.textLight,
    fontSize: 14,
    fontWeight: '700',
  },
  checkboxLabel: {
    fontSize: 14,
    color: Colors.text,
  },
  button: {
    backgroundColor: Colors.accent,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: Colors.textLight,
    fontSize: 16,
    fontWeight: '700',
  },
  errorText: {
    color: Colors.error,
    fontSize: 13,
    marginBottom: 8,
  },
  successBox: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  successIcon: {
    fontSize: 48,
    color: Colors.success,
    marginBottom: 12,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 8,
  },
  successText: {
    fontSize: 16,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  rateDate: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
    marginBottom: 16,
  },
  rateTable: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  rateHeaderRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rateHeaderText: {
    fontWeight: '700',
    color: Colors.primary,
    fontSize: 13,
  },
  rateRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rateLabel: {
    flex: 1.2,
    fontSize: 14,
    color: Colors.text,
    fontWeight: '500',
  },
  rateValue: {
    flex: 0.8,
    fontSize: 14,
    color: Colors.text,
    fontWeight: '600',
    textAlign: 'center',
  },
  rateApr: {
    flex: 1,
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'right',
  },
  rateRowBlock: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rateCaveat: {
    fontSize: 11,
    color: Colors.textSecondary,
    paddingBottom: 8,
    fontStyle: 'italic',
  },
  rateDisclaimer: {
    fontSize: 10,
    color: Colors.textSecondary,
    marginTop: 12,
    lineHeight: 14,
    fontStyle: 'italic',
  },
  noRates: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingVertical: 24,
    fontStyle: 'italic',
  },
  buttonCard: {
    backgroundColor: Colors.surface,
    marginHorizontal: 16,
    marginTop: 20,
    borderRadius: 12,
    padding: 24,
    gap: 10,
    ...Platform.select({
      web: {
        maxWidth: 520,
        alignSelf: 'center' as const,
        width: '100%',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      default: {
        elevation: 3,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
    }),
  },
  historyButton: {
    borderWidth: 2,
    borderColor: Colors.accent,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  historyButtonText: {
    color: Colors.accent,
    fontSize: 16,
    fontWeight: '700',
  },
  calcButton: {
    backgroundColor: Colors.accent,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  calcButtonText: {
    color: Colors.textLight,
    fontSize: 16,
    fontWeight: '700',
  },
  applyButton: {
    backgroundColor: Colors.success,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  applyButtonText: {
    color: Colors.textLight,
    fontSize: 16,
    fontWeight: '700',
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  footerText: {
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  footerVersion: {
    fontSize: 11,
    color: Colors.border,
    marginTop: 4,
  },
});
