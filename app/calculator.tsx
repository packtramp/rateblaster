import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity,
  Platform, Switch,
} from 'react-native';
import { collection, query, orderBy, getDocs, limit } from 'firebase/firestore';
import { db } from '../config/firebase';
import { Colors } from '../constants/colors';

// ─── TYPES ───
type LoanType = 'conventional' | 'fha' | 'va' | 'usda' | 'cash';
type Mode = 'payment' | 'affordability';
type LoanTerm = 30 | 15;

interface Rates { conventional30: number; conventional15: number; fha: number; va: number; usda: number; }
interface MI { monthly: number; upfront: number; }
interface ClosingCosts {
  lender: Record<string, number>;
  attorney: Record<string, number>;
  government: Record<string, number>;
  prepaids: Record<string, number>;
  other: Record<string, number>;
  realtor: { buyerAgent: number; commissionPct: number; sellerConcession: boolean; total: number };
  total: number;
}

// ─── FORMATTING ───
const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const fmtNum = (n: number) => new Intl.NumberFormat('en-US').format(n);
const parse = (s: string) => parseFloat(s.replace(/[$,]/g, '')) || 0;

// ─── CALCULATION ENGINE (ported exactly from Dorsett Group) ───

function calcMonthlyPayment(principal: number, annualRate: number, years: number) {
  const r = annualRate / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

function calcMI(loanAmount: number, homePrice: number, downPct: number, type: LoanType): MI {
  const ltv = ((homePrice - (homePrice * downPct / 100)) / homePrice) * 100;
  switch (type) {
    case 'conventional':
      if (downPct >= 20) return { monthly: 0, upfront: 0 };
      return { monthly: (loanAmount * 0.005) / 12, upfront: 0 };
    case 'fha':
      return { monthly: (loanAmount * (ltv > 95 ? 0.0085 : 0.008)) / 12, upfront: loanAmount * 0.0175 };
    case 'usda':
      return { monthly: (loanAmount * 0.0035) / 12, upfront: homePrice * 0.01 };
    case 'va': {
      let fee = 0.018;
      if (downPct >= 10) fee = 0.0125;
      else if (downPct >= 5) fee = 0.015;
      return { monthly: 0, upfront: loanAmount * fee };
    }
    default: return { monthly: 0, upfront: 0 };
  }
}

function roundUpK(amt: number) { return Math.ceil(amt / 1000) * 1000; }

function ownersPremium(price: number) {
  const k = roundUpK(price) / 1000;
  if (k <= 100) return k * 3.5;
  if (k <= 200) return 100 * 3.5 + (k - 100) * 2.5;
  if (k <= 1000) return 100 * 3.5 + 100 * 2.5 + (k - 200) * 2.0;
  return 100 * 3.5 + 100 * 2.5 + 800 * 2.0 + (k - 1000) * 1.75;
}

function lendersStandalone(loan: number) {
  const k = roundUpK(loan) / 1000;
  if (k <= 100) return k * 3.5;
  return 100 * 3.5 + (k - 100) * 2.0;
}

function titleInsurance(hp: number, la: number, isCash: boolean) {
  const op = ownersPremium(hp);
  if (isCash) return { buyerOwner: op / 2, buyerLender: 0 };
  const ls = lendersStandalone(la);
  const combined = op + 125;
  return { buyerOwner: (combined - ls) / 2, buyerLender: ls / 2 };
}

function calcClosingCosts(la: number, hp: number, type: LoanType, rate: number, commPct: number, sellerPays: boolean): ClosingCosts {
  const isCash = type === 'cash';
  const ti = titleInsurance(hp, la, isCash);

  // Lender
  let lender: Record<string, number> = {};
  if (isCash) {
    lender = { origination: 0, appraisal: 0, credit: 0, underwriting: 0 };
  } else {
    switch (type) {
      case 'conventional': lender = { origination: la * 0.01, appraisal: 525, credit: 45, underwriting: 779 }; break;
      case 'fha': lender = { origination: la * 0.005, appraisal: 499, credit: 35, upfrontMIP: la * 0.0175, processing: 425 }; break;
      case 'usda': lender = { origination: 0, appraisal: 499, credit: 35, upfrontGuarantee: hp * 0.01, underwriting: 779 }; break;
      case 'va': lender = { origination: -1750, appraisal: 475, credit: 35, fundingFee: la * 0.018 }; break;
    }
  }
  lender.total = Object.values(lender).reduce((s, v) => s + v, 0);

  // Attorney
  let attorney: Record<string, number>;
  if (isCash) {
    attorney = { settlement: 400, titleExam: 100, titleUpdate: 0, titleBinder: 100, docPrep: 100, expressPackage: 0, lenderCPL: 0, lenderTitle: 0, ownerTitle: ti.buyerOwner };
  } else {
    attorney = { settlement: 600, titleExam: 100, titleUpdate: 50, titleBinder: 100, docPrep: 100, expressPackage: 65, lenderCPL: 25, lenderTitle: ti.buyerLender, ownerTitle: ti.buyerOwner };
  }
  attorney.total = Object.values(attorney).reduce((s, v) => s + v, 0);

  // Government
  const government: Record<string, number> = {
    recording: 76.5,
    deedTax: isCash ? 57.2 : 57.2 + la * 0.0015,
  };
  government.total = Object.values(government).reduce((s, v) => s + v, 0);

  // Prepaids
  const dailyInt = isCash ? 0 : (la * (rate / 100)) / 365;
  const annIns = hp * 0.00035 * 12;
  const moIns = hp * 0.00035;
  const moTax = hp * 0.00043;
  const prepaids: Record<string, number> = {
    interest: isCash ? 0 : dailyInt * 15,
    insurancePremium: isCash ? 0 : annIns,
    insuranceReserves: isCash ? 0 : moIns * 3,
    taxReserves: isCash ? 0 : moTax * 3,
  };
  prepaids.total = Object.values(prepaids).reduce((s, v) => s + v, 0);

  // Other
  const other = { pestInspection: 45, total: 45 };

  // Realtor
  const buyerAgent = hp * (commPct / 100);
  const realtor = { buyerAgent, commissionPct: commPct, sellerConcession: sellerPays, total: sellerPays ? 0 : buyerAgent };

  const total = lender.total + attorney.total + government.total + prepaids.total + other.total + realtor.total;
  return { lender, attorney, government, prepaids, other, realtor, total };
}

function solveAffordability(budget: number, downPmt: number, rate: number, term: LoanTerm, type: LoanType, hoa: number) {
  if (type === 'cash') {
    const avail = budget - hoa;
    return Math.max(0, Math.round(avail / 0.00078));
  }
  let hp = 100000;
  let inc = 50000;
  for (let i = 0; i < 100; i++) {
    const la = hp - downPmt;
    const dpPct = (downPmt / hp) * 100;
    const pi = calcMonthlyPayment(la, rate, term);
    const tax = hp * 0.00043;
    const ins = hp * 0.00035;
    const mi = calcMI(la, hp, dpPct, type).monthly;
    const total = pi + tax + ins + mi + hoa;
    const diff = budget - total;
    if (Math.abs(diff) < 10) break;
    if (diff > 0) hp += inc;
    else { hp -= inc; inc /= 2; }
  }
  return Math.round(hp);
}

// ─── COMPONENT ───

export default function CalculatorScreen() {
  const [mode, setMode] = useState<Mode>('payment');
  const [loanType, setLoanType] = useState<LoanType>('conventional');
  const [loanTerm, setLoanTerm] = useState<LoanTerm>(30);
  const [rates, setRates] = useState<Rates>({ conventional30: 6.0, conventional15: 5.625, fha: 5.875, va: 5.75, usda: 5.875 });

  // Payment mode inputs
  const [homePrice, setHomePrice] = useState('300000');
  const [downPayment, setDownPayment] = useState('60000');
  const [downPct, setDownPct] = useState('20.0');
  const [interestRate, setInterestRate] = useState('6.00');
  const [hoaFees, setHoaFees] = useState('0');
  const [commPct, setCommPct] = useState('3.0');
  const [sellerPays, setSellerPays] = useState(false);

  // Affordability mode inputs
  const [monthlyBudget, setMonthlyBudget] = useState('2500');
  const [affDownPayment, setAffDownPayment] = useState('60000');
  const [affDownPct, setAffDownPct] = useState('20.0');
  const [affHoa, setAffHoa] = useState('0');
  const [affCommPct, setAffCommPct] = useState('3.0');
  const [affSellerPays, setAffSellerPays] = useState(false);

  // Expanded sections
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Fetch rates from Firestore
  useEffect(() => {
    (async () => {
      try {
        const q2 = query(collection(db, 'rateHistory'), orderBy('date', 'desc'), limit(1));
        const snap = await getDocs(q2);
        if (!snap.empty) {
          const d = snap.docs[0].data();
          const r: Rates = { ...rates };
          if (d.conventional?.rate) { r.conventional30 = d.conventional.rate; r.conventional15 = d.conventional.rate - 0.375; }
          if (d.fha?.rate) r.fha = d.fha.rate;
          if (d.va?.rate) r.va = d.va.rate;
          if (d.usda?.rate) r.usda = d.usda.rate;
          setRates(r);
          setInterestRate(r.conventional30.toFixed(3));
        }
      } catch {}
    })();
  }, []);

  // Auto-update rate when loan type or term changes
  useEffect(() => {
    if (loanType === 'cash') return;
    let r = rates.conventional30;
    if (loanTerm === 15) r = rates.conventional15;
    else {
      switch (loanType) {
        case 'fha': r = rates.fha; break;
        case 'va': r = rates.va; break;
        case 'usda': r = rates.usda; break;
      }
    }
    setInterestRate(r.toFixed(3));
  }, [loanType, loanTerm, rates]);

  // Auto-update down payment defaults on loan type change
  useEffect(() => {
    const hp = parse(homePrice);
    let minPct = 5;
    switch (loanType) {
      case 'fha': minPct = 3.5; break;
      case 'va': case 'usda': minPct = 0; break;
      case 'cash': minPct = 100; break;
    }
    setDownPct(minPct.toFixed(1));
    setDownPayment(Math.round(hp * minPct / 100).toString());
  }, [loanType]);

  const toggle = (key: string) => setExpanded(p => ({ ...p, [key]: !p[key] }));

  const isCash = loanType === 'cash';

  // ─── PAYMENT CALCULATIONS ───
  const pHP = parse(homePrice);
  const pDP = isCash ? pHP : parse(downPayment);
  const pRate = parseFloat(interestRate) || 0;
  const pLA = isCash ? 0 : pHP - pDP;
  const pDPpct = isCash ? 100 : pHP > 0 ? (pDP / pHP) * 100 : 0;
  const pPI = isCash ? 0 : calcMonthlyPayment(pLA, pRate, loanTerm);
  const pTax = pHP * 0.00043;
  const pIns = pHP * 0.00035;
  const pMI = calcMI(pLA, pHP, pDPpct, loanType);
  const pHOA = parse(hoaFees);
  const pTotal = pPI + pTax + pIns + pMI.monthly + pHOA;
  const pTotalPaid = isCash ? pHP : (pPI * loanTerm * 12) + pDP;
  const pTotalInt = isCash ? 0 : (pPI * loanTerm * 12) - pLA;
  const pCC = calcClosingCosts(pLA, pHP, loanType, pRate, parse(commPct), sellerPays);
  const pOOP = pDP + pCC.total;

  // ─── AFFORDABILITY CALCULATIONS ───
  const aBudget = parse(monthlyBudget);
  const aDP = parse(affDownPayment);
  const aHOA = parse(affHoa);
  const aHP = solveAffordability(aBudget, aDP, pRate, loanTerm, loanType, aHOA);
  const aLA = isCash ? 0 : aHP - aDP;
  const aDPpct = isCash ? 100 : aHP > 0 ? (aDP / aHP) * 100 : 0;
  const aPI = isCash ? 0 : calcMonthlyPayment(aLA, pRate, loanTerm);
  const aTax = aHP * 0.00043;
  const aIns = aHP * 0.00035;
  const aMI = calcMI(aLA, aHP, aDPpct, loanType);
  const aTotalPmt = aPI + aTax + aIns + aMI.monthly + aHOA;
  const aTotalPaid = isCash ? aHP : (aPI * loanTerm * 12) + aDP;
  const aTotalInt = isCash ? 0 : (aPI * loanTerm * 12) - aLA;
  const aCC = calcClosingCosts(aLA, aHP, loanType, pRate, parse(affCommPct), affSellerPays);
  const aOOP = aDP + aCC.total;

  // Down payment sync helpers
  const onDPChange = (val: string) => {
    setDownPayment(val);
    const hp = parse(homePrice);
    if (hp > 0) setDownPct(((parse(val) / hp) * 100).toFixed(1));
  };
  const onDPPctChange = (val: string) => {
    setDownPct(val);
    const hp = parse(homePrice);
    setDownPayment(Math.round(hp * (parseFloat(val) || 0) / 100).toString());
  };
  const onHPChange = (val: string) => {
    setHomePrice(val);
    const pct = parseFloat(downPct) || 0;
    setDownPayment(Math.round(parse(val) * pct / 100).toString());
  };

  // ─── RENDER HELPERS ───
  const Row = ({ label, value, hide, color }: { label: string; value: string; hide?: boolean; color?: string }) => {
    if (hide) return null;
    return (
      <View style={s.row}>
        <Text style={s.rowLabel}>{label}</Text>
        <Text style={[s.rowValue, color ? { color } : null]}>{value}</Text>
      </View>
    );
  };

  const SectionHeader = ({ title, total, sKey }: { title: string; total: number; sKey: string }) => (
    <TouchableOpacity style={s.sectionHeader} onPress={() => toggle(sKey)} activeOpacity={0.7}>
      <Text style={s.sectionHeaderText}>{title}</Text>
      <View style={s.sectionRight}>
        <Text style={s.sectionTotal}>{fmt(total)}</Text>
        <Text style={s.expandIcon}>{expanded[sKey] ? '−' : '+'}</Text>
      </View>
    </TouchableOpacity>
  );

  const Input = ({ label, value, onChangeText, suffix, prefix, editable = true, width }: any) => (
    <View style={[s.inputGroup, width ? { width } : null]}>
      <Text style={s.inputLabel}>{label}</Text>
      <View style={s.inputRow}>
        {prefix && <Text style={s.inputPrefix}>{prefix}</Text>}
        <TextInput
          style={[s.input, !editable && s.inputDisabled]}
          value={value}
          onChangeText={onChangeText}
          keyboardType="numeric"
          editable={editable}
          onBlur={() => {
            if (onChangeText && !suffix) {
              const n = parse(value);
              if (n > 0) onChangeText(fmtNum(n));
            }
          }}
          onFocus={() => {
            if (onChangeText) onChangeText(value.replace(/,/g, ''));
          }}
        />
        {suffix && <Text style={s.inputSuffix}>{suffix}</Text>}
      </View>
    </View>
  );

  const renderClosing = (cc: ClosingCosts, prefix: string) => (
    <View style={s.card}>
      <Text style={s.cardTitle}>Closing Costs</Text>
      <Row label="Total Closing Costs" value={fmt(cc.total)} />
      <View style={s.divider} />

      {!isCash && <>
        <SectionHeader title="Lender Fees" total={cc.lender.total} sKey={prefix + 'lender'} />
        {expanded[prefix + 'lender'] && (
          <View style={s.details}>
            <Row label="Origination" value={fmt(cc.lender.origination || 0)} />
            <Row label="Appraisal" value={fmt(cc.lender.appraisal || 0)} />
            <Row label="Credit Report" value={fmt(cc.lender.credit || 0)} />
            <Row label="Underwriting/Fees" value={fmt((cc.lender.underwriting || 0) + (cc.lender.processing || 0) + (cc.lender.upfrontMIP || 0) + (cc.lender.upfrontGuarantee || 0) + (cc.lender.fundingFee || 0))} />
          </View>
        )}
      </>}

      <SectionHeader title="Attorney/Title Fees" total={cc.attorney.total} sKey={prefix + 'attorney'} />
      {expanded[prefix + 'attorney'] && (
        <View style={s.details}>
          <Row label="Settlement Fee" value={fmt(cc.attorney.settlement)} />
          <Row label="Title Exam" value={fmt(cc.attorney.titleExam)} />
          <Row label="Title Update" value={fmt(cc.attorney.titleUpdate)} hide={isCash} />
          <Row label="Title Binder" value={fmt(cc.attorney.titleBinder)} />
          <Row label="Doc Prep" value={fmt(cc.attorney.docPrep)} />
          <Row label="Express Package" value={fmt(cc.attorney.expressPackage)} hide={isCash} />
          <Row label="Lender CPL" value={fmt(cc.attorney.lenderCPL)} hide={isCash} />
          <Row label="Lender's Title" value={fmt(cc.attorney.lenderTitle)} hide={isCash} />
          <Row label="Owner's Title" value={fmt(cc.attorney.ownerTitle)} />
        </View>
      )}

      <SectionHeader title="Government Fees" total={cc.government.total} sKey={prefix + 'gov'} />
      {expanded[prefix + 'gov'] && (
        <View style={s.details}>
          <Row label="Recording" value={fmt(cc.government.recording)} />
          <Row label="Deed Tax" value={fmt(cc.government.deedTax)} />
        </View>
      )}

      {!isCash && <>
        <SectionHeader title="Prepaids" total={cc.prepaids.total} sKey={prefix + 'pre'} />
        {expanded[prefix + 'pre'] && (
          <View style={s.details}>
            <Row label="Prepaid Interest (15 days)" value={fmt(cc.prepaids.interest)} />
            <Row label="Insurance Premium (1 yr)" value={fmt(cc.prepaids.insurancePremium)} />
            <Row label="Insurance Reserves (3 mo)" value={fmt(cc.prepaids.insuranceReserves)} />
            <Row label="Tax Reserves (3 mo)" value={fmt(cc.prepaids.taxReserves)} />
          </View>
        )}
      </>}

      <SectionHeader title="Other Fees" total={cc.other.total} sKey={prefix + 'other'} />
      {expanded[prefix + 'other'] && (
        <View style={s.details}>
          <Row label="Pest Inspection" value={fmt(cc.other.pestInspection)} />
        </View>
      )}

      <SectionHeader title="Realtor Fees" total={cc.realtor.total} sKey={prefix + 'realtor'} />
      {expanded[prefix + 'realtor'] && (
        <View style={s.details}>
          <Row label={`Buyer's Agent (${cc.realtor.commissionPct.toFixed(1)}%)`} value={fmt(cc.realtor.buyerAgent)} />
          <Text style={cc.realtor.sellerConcession ? s.greenNote : s.orangeNote}>
            {cc.realtor.sellerConcession
              ? '✓ Seller concession negotiated (not in out-of-pocket)'
              : '⚠ Buyer pays agent (included in out-of-pocket)'}
          </Text>
        </View>
      )}
    </View>
  );

  // ─── LOAN TYPE SELECTOR ───
  const loanTypes: { key: LoanType; label: string }[] = [
    { key: 'conventional', label: 'Conv' },
    { key: 'fha', label: 'FHA' },
    { key: 'va', label: 'VA' },
    { key: 'usda', label: 'USDA' },
    { key: 'cash', label: 'Cash' },
  ];

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      {/* Mode Toggle */}
      <View style={s.toggleRow}>
        <TouchableOpacity style={[s.toggleBtn, mode === 'payment' && s.toggleActive]} onPress={() => setMode('payment')}>
          <Text style={[s.toggleText, mode === 'payment' && s.toggleTextActive]}>Payment</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.toggleBtn, mode === 'affordability' && s.toggleActive]} onPress={() => setMode('affordability')}>
          <Text style={[s.toggleText, mode === 'affordability' && s.toggleTextActive]}>Affordability</Text>
        </TouchableOpacity>
      </View>

      {/* Shared: Loan Type */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Loan Type</Text>
        <View style={s.loanTypeRow}>
          {loanTypes.map(lt => (
            <TouchableOpacity key={lt.key} style={[s.loanTypeBtn, loanType === lt.key && s.loanTypeBtnActive]} onPress={() => setLoanType(lt.key)}>
              <Text style={[s.loanTypeBtnText, loanType === lt.key && s.loanTypeBtnTextActive]}>{lt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Loan Term */}
        {!isCash && (
          <View style={s.termRow}>
            <Text style={s.inputLabel}>Term</Text>
            <View style={s.termBtns}>
              <TouchableOpacity style={[s.termBtn, loanTerm === 30 && s.termBtnActive]} onPress={() => setLoanTerm(30)}>
                <Text style={[s.termBtnText, loanTerm === 30 && s.termBtnTextActive]}>30 yr</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.termBtn, loanTerm === 15 && s.termBtnActive]} onPress={() => setLoanTerm(15)}>
                <Text style={[s.termBtnText, loanTerm === 15 && s.termBtnTextActive]}>15 yr</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Interest Rate */}
        {!isCash && <Input label="Interest Rate" value={interestRate} onChangeText={setInterestRate} suffix="%" />}
      </View>

      {/* ─── PAYMENT MODE ─── */}
      {mode === 'payment' && (
        <>
          <View style={s.card}>
            <Text style={s.cardTitle}>Calculate Monthly Payment</Text>
            <Input label="Home Price" value={homePrice} onChangeText={onHPChange} prefix="$" />
            <View style={s.dpRow}>
              <Input label="Down Payment" value={downPayment} onChangeText={onDPChange} prefix="$" editable={!isCash} width="60%" />
              <Input label="%" value={downPct} onChangeText={onDPPctChange} suffix="%" editable={!isCash} width="35%" />
            </View>
            <Input label="HOA (monthly)" value={hoaFees} onChangeText={setHoaFees} prefix="$" />
            <View style={s.commRow}>
              <Input label="Buyer Agent %" value={commPct} onChangeText={setCommPct} suffix="%" width="50%" />
              <View style={s.switchRow}>
                <Text style={s.switchLabel}>Seller pays</Text>
                <Switch value={sellerPays} onValueChange={setSellerPays} trackColor={{ true: Colors.success }} />
              </View>
            </View>
          </View>

          {/* Results */}
          <View style={s.card}>
            <Text style={s.bigLabel}>Monthly Payment</Text>
            <Text style={s.bigValue}>{fmt(pTotal)}</Text>
            <Text style={s.bigLabel2}>Out of Pocket</Text>
            <Text style={s.bigValue2}>{fmt(pOOP)}</Text>
          </View>

          <View style={s.card}>
            <Text style={s.cardTitle}>Monthly Breakdown</Text>
            <Row label="Principal & Interest" value={fmt(pPI)} hide={isCash} />
            <Row label="Property Tax" value={fmt(pTax)} />
            <Row label="Home Insurance" value={fmt(pIns)} />
            <Row label="Mortgage Insurance" value={fmt(pMI.monthly)} hide={pMI.monthly === 0} />
            <Row label="HOA" value={fmt(pHOA)} hide={pHOA === 0} />
          </View>

          {!isCash && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Loan Summary</Text>
              <Row label="Loan Amount" value={fmt(pLA)} />
              <Row label="Total Interest" value={fmt(pTotalInt)} />
              <Row label="Total Paid" value={fmt(pTotalPaid)} />
            </View>
          )}

          <View style={s.card}>
            <Text style={s.cardTitle}>Out of Pocket</Text>
            <Row label="Down Payment" value={fmt(pDP)} />
            <Row label="Closing Costs" value={fmt(pCC.total)} />
            <View style={s.divider} />
            <Row label="Total" value={fmt(pOOP)} />
          </View>

          {renderClosing(pCC, 'p')}
        </>
      )}

      {/* ─── AFFORDABILITY MODE ─── */}
      {mode === 'affordability' && (
        <>
          <View style={s.card}>
            <Text style={s.cardTitle}>Calculate Affordability</Text>
            <Input label="Monthly Budget" value={monthlyBudget} onChangeText={setMonthlyBudget} prefix="$" />
            <View style={s.dpRow}>
              <Input label="Down Payment" value={affDownPayment} onChangeText={setAffDownPayment} prefix="$" editable={!isCash} width="60%" />
              <Input label="%" value={affDownPct} onChangeText={setAffDownPct} suffix="%" editable={!isCash} width="35%" />
            </View>
            <Input label="HOA (monthly)" value={affHoa} onChangeText={setAffHoa} prefix="$" />
            <View style={s.commRow}>
              <Input label="Buyer Agent %" value={affCommPct} onChangeText={setAffCommPct} suffix="%" width="50%" />
              <View style={s.switchRow}>
                <Text style={s.switchLabel}>Seller pays</Text>
                <Switch value={affSellerPays} onValueChange={setAffSellerPays} trackColor={{ true: Colors.success }} />
              </View>
            </View>
          </View>

          {/* Results */}
          <View style={s.card}>
            <Text style={s.bigLabel}>You Can Afford</Text>
            <Text style={s.bigValue}>{fmt(aHP)}</Text>
            <Text style={s.bigLabel2}>Est. Monthly Payment</Text>
            <Text style={s.bigValue2}>{fmt(aTotalPmt)}</Text>
            <Text style={s.bigLabel2}>Out of Pocket</Text>
            <Text style={s.bigValue2}>{fmt(aOOP)}</Text>
          </View>

          <View style={s.card}>
            <Text style={s.cardTitle}>Monthly Breakdown</Text>
            <Row label="Principal & Interest" value={fmt(aPI)} hide={isCash} />
            <Row label="Property Tax" value={fmt(aTax)} />
            <Row label="Home Insurance" value={fmt(aIns)} />
            <Row label="Mortgage Insurance" value={fmt(aMI.monthly)} hide={aMI.monthly === 0} />
            <Row label="HOA" value={fmt(aHOA)} hide={aHOA === 0} />
          </View>

          {!isCash && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Loan Summary</Text>
              <Row label="Loan Amount" value={fmt(aLA)} />
              <Row label="Total Interest" value={fmt(aTotalInt)} />
              <Row label="Total Paid" value={fmt(aTotalPaid)} />
            </View>
          )}

          <View style={s.card}>
            <Text style={s.cardTitle}>Out of Pocket</Text>
            <Row label="Down Payment" value={fmt(aDP)} />
            <Row label="Closing Costs" value={fmt(aCC.total)} />
            <View style={s.divider} />
            <Row label="Total" value={fmt(aOOP)} />
          </View>

          {renderClosing(aCC, 'a')}
        </>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ─── STYLES ───
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingBottom: 40 },
  toggleRow: { flexDirection: 'row', justifyContent: 'center', paddingVertical: 16, gap: 8 },
  toggleBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8, borderWidth: 1.5, borderColor: Colors.primary, backgroundColor: Colors.surface },
  toggleActive: { backgroundColor: Colors.primary },
  toggleText: { fontSize: 15, fontWeight: '600', color: Colors.primary },
  toggleTextActive: { color: Colors.textLight },
  card: {
    backgroundColor: Colors.surface, marginHorizontal: 16, marginTop: 12, borderRadius: 12, padding: 20,
    ...Platform.select({
      web: { maxWidth: 600, alignSelf: 'center' as const, width: '100%', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 12 },
      default: { elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8 },
    }),
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: Colors.primary, marginBottom: 12 },
  loanTypeRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 12 },
  loanTypeBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.background },
  loanTypeBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  loanTypeBtnText: { fontSize: 13, fontWeight: '600', color: Colors.text },
  loanTypeBtnTextActive: { color: Colors.textLight },
  termRow: { marginBottom: 12 },
  termBtns: { flexDirection: 'row', gap: 8, marginTop: 4 },
  termBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: Colors.border },
  termBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  termBtnText: { fontSize: 13, fontWeight: '600', color: Colors.text },
  termBtnTextActive: { color: Colors.textLight },
  inputGroup: { marginBottom: 12 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: Colors.border, borderRadius: 8, backgroundColor: Colors.background },
  input: { flex: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: Colors.text },
  inputDisabled: { backgroundColor: '#edf2f7', color: Colors.textSecondary },
  inputPrefix: { paddingLeft: 12, fontSize: 16, color: Colors.textSecondary },
  inputSuffix: { paddingRight: 12, fontSize: 16, color: Colors.textSecondary },
  dpRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  commRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  switchLabel: { fontSize: 13, color: Colors.textSecondary },
  bigLabel: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' },
  bigValue: { fontSize: 36, fontWeight: '800', color: Colors.primary, textAlign: 'center', marginBottom: 8 },
  bigLabel2: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginTop: 4 },
  bigValue2: { fontSize: 22, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  rowLabel: { fontSize: 14, color: Colors.text },
  rowValue: { fontSize: 14, fontWeight: '600', color: Colors.text },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 8 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  sectionHeaderText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  sectionRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTotal: { fontSize: 14, fontWeight: '600', color: Colors.text },
  expandIcon: { fontSize: 18, fontWeight: '700', color: Colors.primary, width: 20, textAlign: 'center' },
  details: { paddingLeft: 12, paddingTop: 4, paddingBottom: 8 },
  greenNote: { fontSize: 12, color: Colors.success, fontStyle: 'italic', marginTop: 4 },
  orangeNote: { fontSize: 12, color: '#DD6B20', fontStyle: 'italic', marginTop: 4 },
});
