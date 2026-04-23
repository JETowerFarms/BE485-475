import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
} from 'react-native';
import { COLORS } from '../styles/theme';

const arrayTypeOptions = [
  { value: '0', label: 'Fixed Open Rack' },
  { value: '2', label: '1-Axis' },
  { value: '3', label: '1-Axis Backtracking' },
  { value: '4', label: '2-Axis' },
];

const moduleTypeOptions = [
  { value: '0', label: 'Standard' },
  { value: '1', label: 'Premium' },
  { value: '2', label: 'Thin Film' },
];

// PV system input fields per selected farm.
const PvSystemInputs = ({
  selectedFarmIds,
  getFarmLabel,
  pvFarmId,
  onPvFarmChange,
  pvDraftInputs,
  onFieldChange,
  onSave,
}) => {
  const [pvFarmDropdownOpen, setPvFarmDropdownOpen] = useState(false);
  const [arrayTypeDropdownOpen, setArrayTypeDropdownOpen] = useState(false);
  const [moduleTypeDropdownOpen, setModuleTypeDropdownOpen] = useState(false);

  return (
    <View style={styles.inputGroup}>
      <Text style={styles.label}>PV System Inputs (per farm)</Text>

      <View style={styles.selectorCard}>
        <Text style={styles.subLabel}>Choose farm</Text>
        <Pressable
          style={[
            styles.dropdownButton,
            selectedFarmIds.length === 0 && styles.dropdownButtonDisabled,
          ]}
          onPress={() => {
            if (selectedFarmIds.length === 0) return;
            setPvFarmDropdownOpen(!pvFarmDropdownOpen);
          }}
        >
          <Text style={styles.dropdownButtonText}>
            {pvFarmId ? getFarmLabel(pvFarmId) : 'Select a farm...'}
          </Text>
          <Text style={styles.dropdownArrow}>{pvFarmDropdownOpen ? '^' : 'v'}</Text>
        </Pressable>

        {pvFarmDropdownOpen && (
          <ScrollView style={styles.dropdownList} nestedScrollEnabled>
            {selectedFarmIds.map((farmId) => (
              <Pressable
                key={farmId}
                style={styles.dropdownItem}
                onPress={() => {
                  onPvFarmChange(farmId);
                  setPvFarmDropdownOpen(false);
                  setArrayTypeDropdownOpen(false);
                  setModuleTypeDropdownOpen(false);
                }}
              >
                <View style={styles.checkbox}>
                  {pvFarmId === farmId && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </View>
                <Text style={styles.dropdownItemText}>{getFarmLabel(farmId)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>

      <Text style={styles.subLabel}>kW per acre</Text>
      <TextInput
        style={styles.input}
        value={pvDraftInputs.kwPerAcre}
        onChangeText={(text) => onFieldChange('kwPerAcre', text)}
        placeholder="e.g., 200 (agrivoltaic)"
        placeholderTextColor={COLORS.placeholder}
        keyboardType="numeric"
      />

      <Text style={styles.subLabel}>Tilt (degrees)</Text>
      <TextInput
        style={styles.input}
        value={pvDraftInputs.tilt}
        onChangeText={(text) => onFieldChange('tilt', text)}
        placeholder="e.g., 35 (optimal for Michigan ~42°N)"
        placeholderTextColor={COLORS.placeholder}
        keyboardType="numeric"
      />

      <Text style={styles.subLabel}>Azimuth (degrees)</Text>
      <TextInput
        style={styles.input}
        value={pvDraftInputs.azimuth}
        onChangeText={(text) => onFieldChange('azimuth', text)}
        placeholder="e.g., 180 (due south)"
        placeholderTextColor={COLORS.placeholder}
        keyboardType="numeric"
      />

      <View style={[styles.selectorCard, { marginTop: 16 }]}>
        <Text style={styles.subLabel}>Array Type</Text>
        <Pressable
          style={[styles.dropdownButton, !pvFarmId && styles.dropdownButtonDisabled]}
          onPress={() => {
            if (!pvFarmId) return;
            setArrayTypeDropdownOpen(!arrayTypeDropdownOpen);
          }}
        >
          <Text style={styles.dropdownButtonText}>
            {pvDraftInputs.arrayType
              ? arrayTypeOptions.find((o) => o.value === pvDraftInputs.arrayType)
                  ?.label || pvDraftInputs.arrayType
              : 'Select array type'}
          </Text>
          <Text style={styles.dropdownArrow}>
            {arrayTypeDropdownOpen ? '^' : 'v'}
          </Text>
        </Pressable>
        {arrayTypeDropdownOpen && (
          <View style={styles.dropdownList}>
            <ScrollView nestedScrollEnabled style={styles.dropdownInnerScroll}>
              {arrayTypeOptions.map((opt) => (
                <Pressable
                  key={opt.value}
                  style={styles.dropdownItem}
                  onPress={() => {
                    onFieldChange('arrayType', opt.value);
                    setArrayTypeDropdownOpen(false);
                  }}
                >
                  <View style={styles.checkbox}>
                    {pvDraftInputs.arrayType === opt.value && (
                      <Text style={styles.checkmark}>✓</Text>
                    )}
                  </View>
                  <Text style={styles.dropdownItemText}>{opt.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
      </View>

      <View style={styles.selectorCard}>
        <Text style={styles.subLabel}>Module Type</Text>
        <Pressable
          style={[styles.dropdownButton, !pvFarmId && styles.dropdownButtonDisabled]}
          onPress={() => {
            if (!pvFarmId) return;
            setModuleTypeDropdownOpen(!moduleTypeDropdownOpen);
          }}
        >
          <Text style={styles.dropdownButtonText}>
            {pvDraftInputs.moduleType
              ? moduleTypeOptions.find((o) => o.value === pvDraftInputs.moduleType)
                  ?.label || pvDraftInputs.moduleType
              : 'Select module type'}
          </Text>
          <Text style={styles.dropdownArrow}>
            {moduleTypeDropdownOpen ? '^' : 'v'}
          </Text>
        </Pressable>
        {moduleTypeDropdownOpen && (
          <View style={styles.dropdownList}>
            <ScrollView nestedScrollEnabled style={styles.dropdownInnerScroll}>
              {moduleTypeOptions.map((opt) => (
                <Pressable
                  key={opt.value}
                  style={styles.dropdownItem}
                  onPress={() => {
                    onFieldChange('moduleType', opt.value);
                    setModuleTypeDropdownOpen(false);
                  }}
                >
                  <View style={styles.checkbox}>
                    {pvDraftInputs.moduleType === opt.value && (
                      <Text style={styles.checkmark}>✓</Text>
                    )}
                  </View>
                  <Text style={styles.dropdownItemText}>{opt.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
      </View>

      <Text style={styles.subLabel}>Losses (%)</Text>
      <TextInput
        style={styles.input}
        value={pvDraftInputs.losses}
        onChangeText={(text) => onFieldChange('losses', text)}
        placeholder="e.g., 16 (Michigan: 14% base + snow)"
        placeholderTextColor={COLORS.placeholder}
        keyboardType="numeric"
      />

      <Pressable
        style={styles.checkboxRow}
        onPress={() => onFieldChange('bifacial', !pvDraftInputs.bifacial)}
      >
        <View style={[styles.checkbox, pvDraftInputs.bifacial && styles.checkboxChecked]}>
          {pvDraftInputs.bifacial ? <Text style={styles.bifacialCheckmark}>✓</Text> : null}
        </View>
        <Text style={styles.subLabel}>Bifacial modules</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  inputGroup: { marginBottom: 16 },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 6,
  },
  subLabel: { fontSize: 14, color: COLORS.textLight, marginBottom: 6 },
  input: {
    backgroundColor: COLORS.inputBg,
    borderWidth: 2,
    borderColor: COLORS.borderLight,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 12,
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
  dropdownButtonDisabled: { opacity: 0.6 },
  dropdownArrow: { color: COLORS.textLight, fontSize: 14, marginLeft: 8 },
  dropdownList: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 8,
    backgroundColor: COLORS.inputBg,
    maxHeight: 200,
  },
  dropdownInnerScroll: { maxHeight: 180 },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  dropdownItemText: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
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
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 10,
  },
  checkboxChecked: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  bifacialCheckmark: { fontSize: 14, fontWeight: 'bold', color: '#FFFFFF' },
  checkmark: { fontSize: 14, fontWeight: 'bold', color: COLORS.accent },
});

export default PvSystemInputs;
