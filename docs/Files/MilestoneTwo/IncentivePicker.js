import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { COLORS } from '../styles/theme';

// Credits & incentives picker section.
const IncentivePicker = ({
  incentiveCatalog,
  incentivesLoading,
  incentivesError,
  selectedIncentiveIds,
  onToggle,
  onSelectAll,
  onClearAll,
  incentiveParams,
  onIncentiveParamChange,
}) => {
  const [incentiveDropdownOpen, setIncentiveDropdownOpen] = useState(false);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Credits & Incentives</Text>

      {incentivesLoading && (
        <Text style={styles.sectionSubtitle}>Loading programs…</Text>
      )}
      {!incentivesLoading && incentivesError && (
        <Text style={[styles.sectionSubtitle, { color: '#c0392b' }]}>
          Could not load incentive catalog — {incentivesError}
        </Text>
      )}
      {!incentivesLoading && !incentivesError && incentiveCatalog.length === 0 && (
        <Text style={styles.sectionSubtitle}>No programs available.</Text>
      )}

      {!incentivesLoading && incentiveCatalog.length > 0 && (
        <View style={styles.selectorCard}>
          <Text style={styles.subLabel}>Select programs</Text>
          <Pressable
            style={styles.dropdownButton}
            onPress={() => setIncentiveDropdownOpen(!incentiveDropdownOpen)}
          >
            <Text style={styles.dropdownButtonText} numberOfLines={1}>
              {selectedIncentiveIds.length === 0
                ? 'None selected'
                : selectedIncentiveIds.length === incentiveCatalog.length
                  ? 'All programs selected'
                  : `${selectedIncentiveIds.length} of ${incentiveCatalog.length} selected`}
            </Text>
            <Text style={styles.dropdownArrow}>
              {incentiveDropdownOpen ? '^' : 'v'}
            </Text>
          </Pressable>

          {incentiveDropdownOpen && (
            <View style={styles.dropdownList}>
              <View style={styles.incentiveActions}>
                <Pressable style={styles.incentiveActionBtn} onPress={onSelectAll}>
                  <Text style={styles.incentiveActionText}>Select All</Text>
                </Pressable>
                <Pressable style={styles.incentiveActionBtn} onPress={onClearAll}>
                  <Text style={styles.incentiveActionText}>Clear All</Text>
                </Pressable>
              </View>

              <ScrollView nestedScrollEnabled style={styles.incentiveScroll}>
                {incentiveCatalog.map((inc) => {
                  const selected = selectedIncentiveIds.includes(inc.id);
                  return (
                    <React.Fragment key={inc.id}>
                      <Pressable
                        style={[
                          styles.incentiveRow,
                          selected && styles.incentiveRowSelected,
                        ]}
                        onPress={() => onToggle(inc.id)}
                      >
                        <View style={styles.checkbox}>
                          {selected && <Text style={styles.checkmark}>✓</Text>}
                        </View>
                        <View style={styles.incentiveInfo}>
                          <Text style={styles.incentiveCat}>{inc.category}</Text>
                          <Text style={styles.incentiveLabel}>{inc.name}</Text>
                          <Text style={styles.incentiveDescText}>
                            {inc.description}
                          </Text>
                        </View>
                      </Pressable>

                      {inc.id === 'brownfield_egle' && selected && (
                        <View style={styles.grantAmountRow}>
                          <Text style={styles.grantAmountLabel}>Grant Amount</Text>
                          <View style={styles.grantAmountButtons}>
                            {[100000, 250000, 500000, 750000, 1000000].map((amt) => {
                              const active =
                                incentiveParams?.brownfield_egle_amount === amt;
                              return (
                                <Pressable
                                  key={amt}
                                  onPress={() =>
                                    onIncentiveParamChange(
                                      'brownfield_egle_amount',
                                      amt,
                                    )
                                  }
                                  style={[
                                    styles.grantAmountBtn,
                                    active && styles.grantAmountBtnActive,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.grantAmountBtnText,
                                      active && styles.grantAmountBtnTextActive,
                                    ]}
                                  >
                                    ${(amt / 1000).toFixed(0)}K
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        </View>
                      )}
                    </React.Fragment>
                  );
                })}
              </ScrollView>
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  section: { marginTop: 18, marginBottom: 6 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 2,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: COLORS.textLight,
    marginBottom: 10,
  },
  selectorCard: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: COLORS.inputBg,
    padding: 12,
    gap: 8,
    marginBottom: 16,
  },
  subLabel: { fontSize: 14, color: COLORS.textLight, marginBottom: 6 },
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: COLORS.inputBg,
  },
  dropdownButtonText: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  dropdownArrow: { color: COLORS.textLight, fontSize: 14, marginLeft: 8 },
  dropdownList: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 8,
    backgroundColor: COLORS.inputBg,
    maxHeight: 200,
  },
  incentiveActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  incentiveActionBtn: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: COLORS.buttonBg,
    borderWidth: 1,
    borderColor: COLORS.buttonBorder,
  },
  incentiveActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.buttonText,
  },
  incentiveScroll: { maxHeight: 280 },
  incentiveRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  incentiveRowSelected: {
    backgroundColor: 'rgba(159, 232, 112, 0.08)',
  },
  incentiveInfo: { flex: 1 },
  incentiveCat: {
    fontSize: 9,
    fontWeight: '700',
    color: COLORS.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  incentiveLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 1,
  },
  incentiveDescText: {
    fontSize: 11,
    color: COLORS.textLight,
    marginTop: 2,
    lineHeight: 15,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: COLORS.borderLight,
    borderRadius: 3,
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.inputBg,
  },
  checkmark: { fontSize: 14, fontWeight: 'bold', color: COLORS.accent },
  grantAmountRow: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#1a2a1a',
    borderBottomWidth: 1,
    borderColor: '#2d5a27',
  },
  grantAmountLabel: {
    color: '#a8d5a2',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 5,
  },
  grantAmountButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  grantAmountBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 5,
    backgroundColor: '#2a3a2a',
    borderWidth: 1,
    borderColor: '#3a4a3a',
  },
  grantAmountBtnActive: {
    backgroundColor: '#4CAF50',
    borderColor: '#66BB6A',
  },
  grantAmountBtnText: { color: '#8a9a8a', fontSize: 12, fontWeight: '600' },
  grantAmountBtnTextActive: { color: '#fff' },
});

export default IncentivePicker;
