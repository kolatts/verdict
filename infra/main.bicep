// =============================================================================
// Verdict — Azure infrastructure
// Deploys all resources into an existing resource group.
// Safe to re-run (idempotent).
//
// NOTE: The consumption plan and function app are intentionally NOT declared
// here. ARM preflight validation incorrectly counts Y1/Dynamic server farms
// against VM quotas on VS Enterprise subscriptions (quota = 0), causing the
// deployment to fail even though no VMs are actually provisioned. The
// workaround is to create the function app via `az functionapp create
// --consumption-plan-location` in the deploy workflow, which bypasses the
// ARM preflight validator and succeeds on the same subscription.
// =============================================================================

@description('Name prefix for all resources (e.g. verdict). Max 10 chars.')
@maxLength(10)
param namePrefix string = 'verdict'

@description('Azure region for all resources.')
param location string = resourceGroup().location

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
// App Insights
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
// Outputs — consumed by the deploy workflow to configure the function app
// ---------------------------------------------------------------------------
output storageAccountName string = storageAccount.name
output appInsightsConnectionString string = appInsights.properties.ConnectionString
