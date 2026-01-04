# Agrivoltaic Optimization Tool - Project Understanding

**Source Document**: Team11_MSUE_Assignment6_DesignAlternatives.docx  
**Date**: November 19, 2025

---

## Executive Summary

This project develops an optimization model for agrivoltaic systems in Michigan's Districts 7, 8, and 13. The model serves as an economic decision-making tool that balances crop yields with photovoltaic energy generation, using predefined infrastructure, environmental, financial, time, and crop parameters. By integrating farmer needs with technical constraints, the tool aims to increase income through optimal land allocation between solar arrays and crops.

---

## Overview

An economic decision-making optimization model for agrivoltaic systems (combined solar panels + agriculture) targeting Michigan's Districts 7, 8, and 13.

### Why Michigan Districts 7, 8, and 13?

These agricultural regions are frequently targeted for solar development because they tend to be:
- **Relatively flat** - easier installation
- **Clear land** - minimal obstacles
- **Well-drained** - suitable for both agriculture and solar infrastructure
- **Access to electrical infrastructure** - grid connectivity for energy export

### The Problem Being Addressed

Recent shifts in global energy supply systems have introduced photovoltaics as a new competitor for land traditionally dedicated to agricultural production. Conversations with farmers have revealed that many had not considered the possibility of growing crops or grazing livestock within solar projects. While solar development is expanding across Michigan, the practice of combining crop production with photovoltaic energy generation remains overlooked.

---

## Purpose

Help farmers maximize income by finding the **optimal land allocation** between solar arrays and crop production, balancing:
- Photovoltaic energy generation
- Crop yields
- Economic returns

### Justification

Life-cycle assessments confirm that solar photovoltaic (PV) systems form a low-carbon alternative to fossil fuel electricity. Agrivoltaics provides opportunities for:
- **Farmers**: Manage vegetation through cropping/grazing while generating additional income
- **Developers**: Receive reliable vegetation management (traditionally outsourced to landscaping companies)
- **Communities**: Benefit from electricity production AND preservation of agricultural land

---

## Target Users

- Farmers in Michigan Districts 7, 8, and 13
- Agricultural consultants
- Solar developers working with farmers
- Michigan State University Extension personnel

---

## Problem Statement

Develop a tool that helps farmers determine:
1. Whether agrivoltaics is economically viable for their specific situation
2. Which solar array configuration best suits their farm
3. How to optimally allocate land between energy production and crops
4. What financial returns they can expect

---

## Objectives

1. Evaluate agrivoltaic system design and implementation in Michigan
2. Create representative farm profiles for the target districts
3. Evaluate different array configurations for dual-use compatibility
4. Validate results with real-world data
5. Identify applicable state and federal incentives to enhance profitability

---

## Key Inputs (Constraint Categories)

### 1. Infrastructure Constraints
- Panel configurations and mounting systems
- Spacing requirements between arrays
- Equipment access and headland needs
- Proper spacing and height of arrays for farming equipment
- Buffer zone requirements
- Soil compaction mitigation during installation
- Topsoil preservation during construction

### 2. Environmental Constraints
- Solar irradiance data (Photosynthetically Active Radiation - PAR)
- Soil conditions and Soil Organic Matter (SOM)
- Climate factors for the region
- Weather patterns specific to Districts 7, 8, 13
- Ecosystem impacts

### 3. Financial Constraints
- Installation and maintenance costs
- Energy prices and revenue
- Crop revenues
- State and federal incentives
- Levelized Cost of Electricity (LCOE)
- Net Present Value (NPV) calculations
- Carbon credits (measured in g CO₂e/kWh)

### 4. Time Constraints
- Project lifespan (typically 25-30 years)
- Seasonal variations in both energy and crop production
- Implementation timeline
- Early coordination requirements between farmers and developers

### 5. Crop Selection Constraints
- Compatible crops for dual-use systems
- Shade tolerance requirements
- Regional growing conditions
- Equipment compatibility for harvesting under/around panels

---

## Design Alternatives Being Evaluated

### Alternative 1: Fixed Tilt Systems

**Description**: Traditional stationary panels mounted at a fixed angle optimized for the latitude.

**Example**: Fixed tilt agrivoltaic system installations in southern New Jersey

| Aspect | Details |
|--------|---------|
| **Pros** | Lower initial cost, simple maintenance, proven technology |
| **Cons** | Less energy production, more shading on crops, less flexible |
| **Best For** | Budget-conscious installations, shade-tolerant crops |

### Alternative 2: Vertical Bifacial Systems

**Description**: Upright panels that capture light on both sides (front and back surfaces). Developed by companies like Next2Sun in Germany.

**How Bifacial Works**: Sunlight reaches panels through multiple paths:
- Direct sunlight on front surface
- Reflected light from ground on back surface
- Diffuse light on both surfaces

| Aspect | Details |
|--------|---------|
| **Pros** | Better crop access between rows, less land loss, captures morning and evening sun |
| **Cons** | Higher initial cost, newer technology with less field data |
| **Best For** | Row crops, farms prioritizing agricultural production |

### Alternative 3: Single Axis Tracking Systems

**Description**: Panels mounted on a rotating axis that follows the sun's path throughout the day.

**Example**: Single axis tracking system in Grembergen, Belgium

| Aspect | Details |
|--------|---------|
| **Pros** | Maximum energy capture (15-25% more than fixed), optimized sun exposure |
| **Cons** | Highest cost, more maintenance, more land lost to buffer zones, mechanical complexity |
| **Best For** | Energy-focused installations, high-value land where maximizing kWh is priority |

### Decision Matrix Criteria

The report evaluates these 3 alternatives across 10 parameters using a weighted decision matrix (see Table B1 in report).

---

## Key Metric: Land Equivalence Ratio (LER)

The primary metric for evaluating agrivoltaic performance:

```
LER = (Yield_Crop_AV / Yield_Crop_conv) × (1 - LL) + (Yield_elec_AV / Yield_elec_conv)
```

Where:
- `Yield_Crop_AV` = Crop yield under agrivoltaic system
- `Yield_Crop_conv` = Conventional crop yield (baseline)
- `LL` = Land loss factor (0-1), percentage of land lost to structures and buffer zones
- `Yield_elec_AV` = Electricity yield from agrivoltaic system
- `Yield_elec_conv` = Conventional solar-only electricity yield

### Interpreting LER

| LER Value | Meaning |
|-----------|---------|
| **LER = 1.0** | Agrivoltaic system equals separate land uses |
| **LER > 1.0** | Agrivoltaic system is MORE productive than separate uses |
| **LER = 1.3** | 30% more productive - equivalent to having 30% more land |
| **LER < 1.0** | Separate land uses would be more productive |

---

## Expected Tool Outputs

1. **Optimal array configuration** recommendation (Fixed Tilt, Vertical Bifacial, or Single Axis Tracking)
2. **Land allocation strategy** (solar vs. crop percentages)
3. **Financial projections**:
   - Net Present Value (NPV)
   - Levelized Cost of Electricity (LCOE)
   - Combined income from energy + crops
   - Payback period
4. **Applicable incentives** (state and federal programs)
5. **Land Equivalence Ratio** calculation for the specific configuration
6. **Risk assessment** based on selected parameters

---

## Client & Stakeholders

- **Client**: Charles Gould (Michigan State University Extension)
- **Faculty Advisors**: Dr. Srivastava, Aluel Go
- **Course Instructors**: Dr. Sanghyup Jeong, Dr. Luke Reese

---

## Project Team (BE 485 - Biosystems Design Techniques)

| Name | Role |
|------|------|
| Joshua Dixon | Project Manager |
| Danielle Edington | Communication and Stakeholder Manager |
| Miguel Martinez-Garcia | Quality and Risk Manager |
| Diana Mejia | Technical Lead |

---

## Technical Considerations

### Standards & Regulations

| Standard | Application |
|----------|-------------|
| **NEC** (National Electrical Code) | Electrical safety for PV installations |
| **IEEE** (Institute of Electrical and Electronics Engineers) | Photovoltaic system standards |
| **ISO** (International Organization for Standardization) | Quality and environmental management |
| **FSMA** (Food Safety Modernization Act) | Crop safety near solar installations |
| **MIOSHA** (Michigan Occupational Safety and Health Administration) | Worker safety during installation/maintenance |

### Safety Elements

#### Environmental Safety
- Soil protection during installation
- Water management and drainage
- Ecosystem impact mitigation
- Topsoil preservation protocols

#### Electrical Safety
- Panel installations meeting NEC requirements
- Grid connections and inverter safety
- Grounding and lightning protection
- Maintenance access safety

#### Structural and Mechanical Safety
- Mounting system integrity
- Weather resistance (wind, snow, ice loads)
- Foundation requirements
- Equipment clearance for farming operations

---

## Project Phases and Timeline

### Phase 1 – Background, Standards, and Stakeholder Engagement
- Literature review
- Standards identification
- Initial stakeholder interviews
- **Budget**: $250

### Phase 2 – Data Collection, Case Studies, and Co-Design With Growers
- Farm data collection
- Case study analysis
- Farmer co-design sessions
- **Budget**: $250

### Phase 3 – Optimization Model Development
- Model architecture design
- Algorithm development
- Integration of data sources
- **Budget**: $250

### Phase 4 – Synthesis, Recommendations, and Final Deliverables
- Model validation
- Documentation
- Final tool delivery
- **Budget**: $250

**Total Project Budget**: $1,000

---

## App Development Notes

This React Native app will serve as the **mobile interface** for the optimization tool, allowing farmers to:

### Core Features
1. **Input farm parameters**
   - Acreage and field dimensions
   - Location (district selection)
   - Current crops and yields
   - Existing infrastructure

2. **Select constraints and preferences**
   - Budget limitations
   - Risk tolerance
   - Priority (energy vs. agriculture focus)
   - Equipment specifications

3. **View optimization results**
   - Recommended array configuration
   - Land allocation map
   - LER calculation breakdown

4. **Compare configurations**
   - Side-by-side comparison of Fixed Tilt, Vertical Bifacial, Single Axis
   - Financial comparison over project lifespan

5. **Access financial projections**
   - NPV and LCOE calculations
   - Income projections (energy + crops)
   - Incentive eligibility checker
   - ROI timeline visualization

---

## Data Sources to Integrate

| Data Type | Source |
|-----------|--------|
| Solar calculations | PVWatts / SAM (System Advisor Model) |
| Crop yield data | USDA, Michigan agricultural statistics |
| Energy prices | Michigan utility rates, wholesale market data |
| Incentive programs | DSIRE database, state programs |
| Weather/irradiance | NREL, local weather stations |
| Equipment specifications | Manufacturer datasheets |

---

## Units Reference

| Unit | Description |
|------|-------------|
| ° | Degree of panel orientation |
| °C / °F | Temperature |
| ft / ft² | Feet / Square feet |
| g CO₂e/kWh | Grams carbon dioxide equivalent per kilowatt-hour |
| mi | Miles |

---

## Acronyms Quick Reference

| Acronym | Full Name |
|---------|-----------|
| FSMA | Food Safety Modernization Act |
| IEEE | Institute of Electrical and Electronics Engineers |
| ISO | International Organization for Standardization |
| LCOE | Levelized Cost of Electricity |
| LER | Land Equivalence Ratio |
| LL | Land Loss |
| MIOSHA | Michigan Occupational Safety and Health Administration |
| NEC | National Electrical Code |
| NPV | Net Present Value |
| PAR | Photosynthetically Active Radiation |
| PV | Photovoltaics |
| PVWatts | Photovoltaic Watts (NREL tool) |
| SAM | System Advisor Model |
| SOM | Soil Organic Matter |

---

## Future Development Goals

1. **Refine the model** by defining representative farm profiles
2. **Evaluate array configurations** with real Michigan data
3. **Validate results** with existing agrivoltaic installations
4. **Identify incentives** - compile applicable state and federal programs
5. **Enhance profitability calculations** for long-term dual-use applications
6. **Mobile app deployment** for field use by farmers and consultants
