package com.example.ticketreservation.repository;

import com.example.ticketreservation.model.Reservation;
import com.example.ticketreservation.model.ReservationStatus;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.Collection;
import java.util.List;

public interface ReservationRepository extends MongoRepository<Reservation, String> {
    List<Reservation> findByCustomer(String customer);

    List<Reservation> findByEventId(String eventId);

    List<Reservation> findByEventIdIn(Collection<String> eventIds);

    /** Used to block deletion of an event that still has confirmed bookings. */
    boolean existsByEventIdAndStatus(String eventId, ReservationStatus status);

    /** Used to block deletion of a user (customer) who still has confirmed bookings. */
    boolean existsByCustomerAndStatus(String customer, ReservationStatus status);
}
