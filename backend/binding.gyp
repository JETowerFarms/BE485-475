{
  "targets": [
    {
      "target_name": "farmResolution",
      "sources": [
        "src/utils/farmResolution.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "cflags": [
        "-std=c++17"
      ],
      "cflags_cc": [
        "-std=c++17",
        "-fexceptions"
      ],
      "cflags_cc!": [
        "-fno-exceptions"
      ],
      "xcode_settings": {
        "OTHER_CFLAGS": [
          "-std=c++17"
        ]
      },
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": [
            "/std:c++17"
          ]
        }
      }
    },
    {
      "target_name": "solarSuitabilityParser",
      "sources": [
        "src/utils/solarSuitabilityParser.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "cflags": [
        "-std=c++17"
      ],
      "cflags_cc": [
        "-std=c++17"
      ],
      "xcode_settings": {
        "OTHER_CFLAGS": [
          "-std=c++17"
        ]
      },
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": [
            "/std:c++17"
          ]
        }
      }
    },
    {
      "target_name": "elevationHeatMapParser",
      "sources": [
        "src/utils/elevationHeatMapParser.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "cflags": [
        "-std=c++17"
      ],
      "cflags_cc": [
        "-std=c++17"
      ],
      "xcode_settings": {
        "OTHER_CFLAGS": [
          "-std=c++17"
        ]
      },
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": [
            "/std:c++17"
          ]
        }
      }
    },
    {
      "target_name": "clearingCostParser",
      "sources": [
        "src/utils/clearingCostParser.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "cflags": [
        "-std=c++17"
      ],
      "cflags_cc": [
        "-std=c++17",
        "-fexceptions"
      ],
      "cflags_cc!": [
        "-fno-exceptions"
      ],
      "xcode_settings": {
        "OTHER_CFLAGS": [
          "-std=c++17"
        ]
      },
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": [
            "/std:c++17"
          ]
        }
      }
    }
  ]
}