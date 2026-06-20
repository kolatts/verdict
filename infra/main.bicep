// =============================================================================
// Verdict — Azure infrastructure
// Deploys all resources into an existing resource group.
// Safe to re-run (idempotent).
// =============================================================================

@description('Name prefix for all resources (e.g. verdict). Max 10 chars.')
@maxLength(10)
param namePrefix string = 'verdict'

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('GitHub Pages origin allowed by CORS (e.g. https://user.github.io).')
param pagesOrigin string

@description('App Insights daily data cap in GB (0 = disabled).')
param appInsightsDailyCapGb int = 0

// ---------------------------------------------------------------------------
// Storage account — backs Azure Functions runtime and Table Storage
// ---------------------------------------------------------------------------
var storageAccountName = toLower('st${namePrefix}${uniqueString(resourceGroup().id)}')

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

// ---------------------------------------------------------------------------
// App Insights (optional; comment out to skip)
// ---------------------------------------------------------------------------
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${namePrefix}-ai'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    IngestionMode: 'ApplicationInsights'
  }
}

// ---------------------------------------------------------------------------
// Consumption plan (Y1 = serverless, free tier)
// ---------------------------------------------------------------------------
resource consumptionPlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: '${namePrefix}-plan'
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {}
}

// ---------------------------------------------------------------------------
// Function App (.NET 10 isolated worker, Functions v4)
// ---------------------------------------------------------------------------
var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

resource functionApp 'Microsoft.Web/sites@2023-01-01' = {
  name: '${namePrefix}-fn'
  location: location
  kind: 'functionapp'
  properties: {
    serverFarmId: consumptionPlan.id
    httpsOnly: true
    siteConfig: {
      netFrameworkVersion: 'v10.0'
      cors: {
        allowedOrigins: [
          pagesOrigin
          'http://localhost:8080'   // local frontend dev
          'http://127.0.0.1:5500'  // VS Code Live Server
        ]
        supportCredentials: false
      }
      appSettings: [
        { name: 'AzureWebJobsStorage',          value: storageConnectionString }
        { name: 'FUNCTIONS_EXTENSION_VERSION',   value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME',      value: 'dotnet-isolated' }
        { name: 'TableConnection',               value: storageConnectionString }
        { name: 'APPINSIGHTS_INSTRUMENTATIONKEY', value: appInsights.properties.InstrumentationKey }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
      ]
    }
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
output functionAppName string = functionApp.name
output functionAppHostName string = functionApp.properties.defaultHostName
output storageAccountName string = storageAccount.name
