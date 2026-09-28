# Werkgroep: Ontwerp MijnZaken Service (Definition of Done)

Dit document beschrijft de functionele en technische specificaties van de MijnZaken service. Het dient als de "Definition of Done" voor de implementatie en integratie van zaakgerichte informatie binnen een MijnOmgeving, in lijn met de VNG MijnServices standaarden.

## Inleiding

MijnZaken is een track & trace-service waarmee inwoners en ondernemers de status van aanvragen van producten of diensten kunnen volgen. Het biedt transparantie en efficiëntie door real-time statusinformatie aan te bieden over een product of dienst.

Voor inwoners biedt het rust en duidelijkheid; voor gemeenten verlaagt het de druk op het Klantcontactcentrum (KCC) doordat statusvragen online beantwoord worden.

## Uitgangspunten

- **BSN/KvK Identificatie**: Interacties gaan uit van een geverifieerde identiteit (BSN voor burgers, KvK voor bedrijven) via DigiD of eHerkenning.
- **Common Ground**: Gegevens worden bij de bron opgehaald uit het zaaksysteem. Er is geen sprake van een afzonderlijk portaal-register.
- **ZGW API's**: Voor de ontsluiting wordt gebruik gemaakt van de landelijke [ZGW API standaarden](https://vng-realisatie.github.io/gemma-zaken/standaard/).
- **Data-minimalisatie**: Alleen velden die relevant zijn voor de burger worden ontsloten (bijv. omschrijving, status, einddatum).
- **NL Design System**: De presentatie volgt de [NL Design System richtlijnen](https://nldesignsystem.nl/).

## Capabilities

| Capability                                  | Toelichting                                                                                                    |
| :------------------------------------------ | :------------------------------------------------------------------------------------------------------------- |
| **Bieden van interactieve dienstverlening** | Het portaal biedt een gepersonaliseerde ervaring op basis van de identiteit van de ingelogde gebruiker.        |
| **Overzicht en inzage bieden van zaken**    | De gebruiker kan een lijst van al zijn lopende en afgeronde zaken inzien, inclusief de historie van statussen. |

## Bedrijfsobjectenmodel

Het model is gebaseerd op het [Informatiemodel Zaken (RGBZ)](https://github.com/VNG-Realisatie/RGBZ).

| Bedrijfsobject       | Definitie                                                                                |
| :------------------- | :--------------------------------------------------------------------------------------- |
| **ZAAK**             | Een samenhangende hoeveelheid werk met een welgedefinieerde aanleiding en eindresultaat. |
| **STATUS**           | De actuele voortgangsstap van de zaak (bijv. "In behandeling").                          |
| **INFORMATIEOBJECT** | Documenten gerelateerd aan de zaak (bijv. de aanvraag of het besluit).                   |
| **ROL**              | De hoedanigheid van de burger (bijv. 'Initiator').                                       |
| **RESULTAAT**        | De formele uitkomst (bijv. 'Verleend').                                                  |

## Informatiearchitectuur

De architectuur verbindt de volgende componenten:

- **Mijngemeentecomponent**: De frontend (MijnOmgeving).
- **Zakenbeheercomponent (ZRC)**: De API voor zaakgegevens.
- **Documentbeheercomponent (DRC)**: De API voor bijbehorende documenten.
- **Zaaktypecatalogus (ZTC)**: De bron voor processtap-definities.

## Standaarden

- **API Specificaties**: [ZGW API v1.5+](https://github.com/VNG-Realisatie/gemma-zaken)
- **Informatiemodel**: [RGBZ 2.0](https://github.com/VNG-Realisatie/RGBZ)
- **Beveiliging**: OAuth 2.0 (System-to-System), mTLS aanbevolen.
- **Design**: [MijnServices Storybook](https://nl-design-system.github.io/mijn-services/)

## API’s en Identificatie

De gegevens worden direct bij de bron (ZRC) opgevraagd via een gestandaardiseerde interface.

### OAuth 2.0 Client Credentials

Net als bij de [MijnAfspraken Service](https://platformvoordienstverlening.notion.site/Werkgroep-Ontwerp-MijnAfspraken-Service-25d78b5f4db480dea4b3ed413134a47b) wordt gebruik gemaakt van client credentials voor de communicatie tussen portaal en API. Het portaal is verantwoordelijk voor de BSN-filtering.

### Zoek-patroon

- **Endpoint**: `POST /zaken/zoeken`
- **Rationale**: Er wordt POST gebruikt in plaats van GET omdat identificatiegegevens (BSN) niet in de URL mogen verschijnen (privacy/logging).
- **Filter**: Er wordt gefilterd op `rollen__betrokkeneIdentificatie__getal` (BSN).

### Twee-staps flow

1.  **Zoeklijst**: Haal een lijst van zaken op met basiskenmerken.
2.  **Detailweergave**: Haal via `GET /zaken/{uuid}` de volledige details op, inclusief statushistorie via de gerelateerde `/statussen` endpoint.

## Informatiebeveiliging en Privacy

- **BSN-gebruik**: Het BSN wordt uitsluitend gebruikt als filterparameter bij de bron; het wordt niet opgeslagen in de portaal-laag.
- **Zichtbaarheid**: Alleen documenten met een `vertrouwelijkheidaanduiding` die past bij de rechten van de burger worden getoond.
- **Logging**: Alle bevragingen op basis van BSN worden gelogd conform de BIO (Baseline Informatiebeveiliging Overheid).

## Beheer

- **Eigenaarschap**: De vakafdeling (bronhouder) is verantwoordelijk voor de kwaliteit en tijdigheid van de statusupdates in het zaaksysteem.
- **Service Level**: Beschikbaarheid van de API is kritisch voor de werking van de MijnOmgeving.
