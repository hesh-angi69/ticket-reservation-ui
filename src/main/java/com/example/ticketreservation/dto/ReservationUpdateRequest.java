package com.example.ticketreservation.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/** Body of PUT /api/reservations/{id}: the new number of seats. */
public record ReservationUpdateRequest(
        @Min(value = 1, message = "seats must be at least 1")
        @Max(value = 10, message = "you can reserve at most 10 seats at once") int seats) {
}
